import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { request, type APIRequestContext } from "@playwright/test";
import { Routes } from "../api/endpoints/routes";
import type { PlatformUniversityHandover } from "./platformClient";
import { blankEnvKeys, resetRunState, upsertEnv } from "./runState";

/**
 * Every `.env` key that belongs to one university. Their values are blanked
 * before a new university is provisioned, then replaced with the new university's
 * values. Platform, browser and database settings are never in this list.
 */
export const TENANT_ENV_KEYS = [
  "WEB_APP_URL",
  "DVS_WEB_BASE_URL",
  "DVS_BASE_URL",
  "DVS_API_BASE_URL",
  "DVS_API_TOKEN",
  "DVS_TENANT_ID",
  "DVS_TENANT_NAME",
  "DVS_ADMIN_EMAIL",
  "DVS_ADMIN_PASSWORD",
  "DVS_ADMIN_TEMP_PASSWORD",
  "DVS_UNIVERSITY_NAME",
  "DVS_UNIVERSITY_CODE",
  "DVS_UNIVERSITY_ADMIN_EMAIL",
  "DVS_UNIVERSITY_ADMIN_PASSWORD",
  "DVS_USER_MANAGER_EMAIL",
  "DVS_USER_MANAGER_PASSWORD",
  "DVS_CHAIRMAN_EMAIL",
  "DVS_CHAIRMAN_PASSWORD",
  "DVS_CHIEF_EMAIL",
  "DVS_CHIEF_PASSWORD",
  "DVS_EVALUATOR_EMAIL",
  "DVS_EVALUATOR_PASSWORD",
  "DVS_SCANNER_EMAIL",
  "DVS_SCANNER_PASSWORD",
] as const;

/**
 * Blanks the previous university's values in `.env`, resets the run state and
 * drops the face marker. The keys stay in place; the new university fills them.
 */
export function clearTenantRuntime(): void {
  blankEnvKeys(TENANT_ENV_KEYS);
  resetRunState({});

  const faceFlag = path.resolve(process.cwd(), "playwright", ".auth", "face-enrolled.flag");
  if (fs.existsSync(faceFlag)) fs.rmSync(faceFlag);
}

/** Created-university details written to `.env` and the run state. */
export type ProvisionedUniversity = {
  tenantId: string;
  tenantUrl: string;
  name: string;
  code: string;
  adminEmail: string;
};

/**
 * Creates a request context on the new tenant origin.
 * @param tenantUrl - Provisioned university URL
 */
async function tenantContext(tenantUrl: string): Promise<APIRequestContext> {
  const origin = tenantUrl.replace(/\/+$/, "");
  return request.newContext({
    baseURL: `${origin}/`,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Accept: "application/json", Origin: origin, Referer: `${origin}/` },
  });
}

/** CSRF header from the tenant session cookie. */
async function csrfHeaders(api: APIRequestContext): Promise<Record<string, string>> {
  const state = await api.storageState();
  const token = state.cookies.find((cookie) => cookie.name === "csrftoken")?.value;
  return token ? { "X-CSRFToken": token } : {};
}

/**
 * Signs in on the new tenant with the one-time handover password.
 * @param api - Tenant request context
 * @param email - Provisioned administrator email
 * @param password - One-time temporary password
 */
async function tenantLogin(
  api: APIRequestContext,
  email: string,
  password: string,
): Promise<number> {
  const response = await api.post(Routes.AUTH_LOGIN.replace(/^\//, ""), {
    data: {
      email,
      password,
      device_id: randomUUID(),
      device_label: "Win32 · Tenant Bootstrap",
      platform: "Win32",
      browser: "Playwright Tenant Bootstrap",
    },
  });
  return response.status();
}

/** Result of relaxing one university's evaluation timing policy. */
export type EvaluationTimingPolicy = {
  /** Minimum submission time in minutes after the change (0 = no wait). */
  minimumSubmissionMinutes: number;
  /** Evaluation security flags that were switched off. */
  disabledFlags: number;
};

/** Policy keys that carry the "time and inactivity" minimum submission time. */
const MINIMUM_SUBMISSION_KEYS = [
  // The console persists both spellings; the camelCase one is the value the
  // evaluator's submission window actually reads.
  "minEvaluationMinutes",
  "min_evaluation_minutes",
  "minimumEvaluationMinutes",
  "minimum_evaluation_minutes",
  "evaluation_min_minutes",
  "min_submission_minutes",
  "minimum_submission_minutes",
] as const;

/**
 * Applies the Admin's Access governance > Evaluation security > Time and
 * inactivity setting: the minimum submission time becomes 0, so an evaluator can
 * submit as soon as every page has been marked, and the strict evaluation
 * session flags are switched off for the tenant.
 *
 * This writes the same policy the console writes. It is a documented Admin
 * control, not a test bypass.
 * @param tenantUrl - Provisioned university origin
 * @param adminEmail - University administrator email
 * @param adminPassword - Permanent administrator password
 * @returns The applied minimum submission time and how many flags were disabled
 */
export async function applyEvaluationTimingPolicy(
  tenantUrl: string,
  adminEmail: string,
  adminPassword: string,
): Promise<EvaluationTimingPolicy> {
  const api = await tenantContext(tenantUrl);
  try {
    const login = await tenantLogin(api, adminEmail, adminPassword);
    if (login !== 200) {
      throw new Error(`Admin login failed (${login}) while relaxing the evaluation policy.`);
    }

    const stepUp = await api.post(Routes.AUTH_STEP_UP.replace(/^\//, ""), {
      data: { password: adminPassword },
      headers: await csrfHeaders(api),
    });
    if (!stepUp.ok()) {
      throw new Error(`Admin step-up failed (${stepUp.status()}) before the policy change.`);
    }

    const catalogResponse = await api.get(Routes.SECURITY_CATALOG.replace(/^\//, ""));
    if (!catalogResponse.ok()) {
      throw new Error(`Reading the security catalog failed (${catalogResponse.status()}).`);
    }
    const catalog = (await catalogResponse.json()) as { policy?: Record<string, unknown> };
    const policy = catalog.policy;
    if (!policy || typeof policy !== "object") {
      throw new Error("The security catalog returned no policy.");
    }

    let minimumSubmissionMinutes = -1;
    for (const key of MINIMUM_SUBMISSION_KEYS) {
      if (typeof policy[key] === "number") {
        policy[key] = 0;
        minimumSubmissionMinutes = 0;
      }
    }

    let disabledFlags = 0;
    for (const [key, value] of Object.entries(policy)) {
      const evaluationFlag =
        key.startsWith("evaluation_") ||
        ["require_mfa", "require_trusted_device", "dlp_enabled"].includes(key);
      if (evaluationFlag && typeof value === "boolean" && value) {
        policy[key] = false;
        disabledFlags += 1;
      }
    }

    const saved = await api.put(Routes.SECURITY_POLICY.replace(/^\//, ""), {
      data: policy,
      headers: await csrfHeaders(api),
    });
    if (!saved.ok()) {
      throw new Error(
        `Saving the evaluation timing policy failed (${saved.status()}): ${(await saved.text()).slice(0, 300)}`,
      );
    }

    return { minimumSubmissionMinutes, disabledFlags };
  } finally {
    await api.dispose();
  }
}

/**
 * Replaces the handover password on the new university's administrator account
 * and proves the permanent password works. The temporary password is single-use,
 * so it is never persisted.
 * @param handover - Values returned by the platform provisioning call
 * @param permanentPassword - Team-standard permanent password
 * @returns The created university, ready for the remaining workflow
 */
export async function completeUniversityAdminFirstLogin(
  handover: PlatformUniversityHandover,
  permanentPassword: string,
): Promise<ProvisionedUniversity> {
  if (!permanentPassword) {
    throw new Error("Set DVS_ROLE_NEW_PASSWORD so the new administrator password can be set.");
  }

  const api = await tenantContext(handover.tenantUrl);
  try {
    const firstLogin = await tenantLogin(api, handover.adminEmail, handover.temporaryPassword);
    if (firstLogin !== 200) {
      throw new Error(
        `The administrator temporary password was rejected (${firstLogin}) for ${handover.adminEmail}.`,
      );
    }

    const setup = await api.post(Routes.AUTH_PASSWORD_COMPLETE_SETUP.replace(/^\//, ""), {
      data: { new_password: permanentPassword },
      headers: await csrfHeaders(api),
    });
    if (!setup.ok()) {
      throw new Error(
        `Setting the permanent password failed (${setup.status()}): ${(await setup.text()).slice(0, 300)}`,
      );
    }
  } finally {
    await api.dispose();
  }

  const verify = await tenantContext(handover.tenantUrl);
  try {
    const login = await tenantLogin(verify, handover.adminEmail, permanentPassword);
    if (login !== 200) {
      throw new Error(`The permanent administrator password was rejected (${login}).`);
    }
    const me = await verify.get(Routes.AUTH_ME.replace(/^\//, ""));
    if (!me.ok()) {
      throw new Error(`auth/me failed after the first login (${me.status()}).`);
    }
    const body = (await me.json()) as Record<string, unknown>;
    const role = String(body.role ?? "");
    if (!/admin/i.test(role)) {
      throw new Error(`The provisioned account role is "${role}", expected an administrator role.`);
    }
  } finally {
    await verify.dispose();
  }

  return {
    tenantId: handover.tenantId,
    tenantUrl: handover.tenantUrl.replace(/\/+$/, ""),
    name: handover.name,
    code: handover.code,
    adminEmail: handover.adminEmail,
  };
}

/**
 * Writes the new university's runtime configuration for the rest of the run.
 * A fresh run state replaces the previous tenant's ids and role emails so no
 * record can leak across universities.
 * @param university - Provisioned university
 * @param permanentPassword - Permanent administrator password
 */
export function persistUniversity(
  university: ProvisionedUniversity,
  permanentPassword: string,
): void {
  upsertEnv({
    DVS_ALLOW_WRITES: "true",
    WEB_APP_URL: university.tenantUrl,
    DVS_WEB_BASE_URL: university.tenantUrl,
    DVS_API_BASE_URL: university.tenantUrl,
    DVS_ADMIN_EMAIL: university.adminEmail,
    DVS_ADMIN_PASSWORD: permanentPassword,
    DVS_TENANT_NAME: university.name,
    DVS_TENANT_ID: university.tenantId,
    DVS_UNIVERSITY_NAME: university.name,
    DVS_UNIVERSITY_CODE: university.code,
    DVS_UNIVERSITY_ADMIN_EMAIL: university.adminEmail,
    DVS_UNIVERSITY_ADMIN_PASSWORD: permanentPassword,
  });

  resetRunState({
    university: {
      tenantId: university.tenantId,
      name: university.name,
      code: university.code,
      tenantUrl: university.tenantUrl,
      adminEmail: university.adminEmail,
    },
    emails: {},
    ids: {},
  });
}
