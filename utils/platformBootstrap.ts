import { expect, type Browser, type Page } from "@playwright/test";
import { AuthenticatedShellPage } from "../pages/AuthenticatedShellPage";
import { LoginPage } from "../pages/LoginPage";
import { SetPasswordPage } from "../pages/SetPasswordPage";
import type { PlatformHandover } from "../pages/PlatformAdminPage";
import { signInAndResolveState } from "./dvsAuth";
import { saveRunState, upsertEnv } from "./runState";

/** Normalized handover for a newly provisioned university. */
export type UniversityProvision = {
  tenantId: string;
  name: string;
  code: string;
  subdomain: string;
  tenantUrl: string;
  adminEmail: string;
  temporaryPassword: string;
};

const PASSWORD_KEY = /^(temporary_password|temp_password|initial_password|password)$/i;
const EMAIL_KEY = /^(admin_email|administrator_email|email)$/i;

/**
 * Walks a JSON value and returns the first value whose key matches.
 * @param value - Parsed JSON
 * @param matcher - Key predicate
 * @returns The first matching primitive, or undefined
 */
function findDeep(value: unknown, matcher: RegExp, seen = new Set<unknown>()): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDeep(item, matcher, seen);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (matcher.test(key) && (typeof child === "string" || typeof child === "number")) {
      return String(child);
    }
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findDeep(child, matcher, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** True when a string looks like an https base URL. */
function asHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value.replace(/\/+$/, "");
  if (/^[\w-]+(\.[\w-]+)+/.test(value)) return `https://${value.replace(/\/+$/, "")}`;
  return undefined;
}

/**
 * Normalizes the create-tenant response into a handover. The response is the
 * primary source because it carries the one-time temporary password; the DOM
 * handover is only a fallback.
 * @param response - Parsed `POST /api/v1/enterprise/tenants` body
 * @param baseDomain - Shared platform base domain, e.g. `35-200-205-253.sslip.io`
 * @param domHandover - Values scraped from the visible handover sheet
 * @param request - Values the caller sent (used to fill gaps)
 */
export function normalizeProvisionResponse(
  response: Record<string, unknown>,
  baseDomain: string,
  domHandover: Partial<PlatformHandover> = {},
  request: Partial<UniversityProvision> = {},
): UniversityProvision {
  const adminEmail =
    findDeep(response, EMAIL_KEY) ?? domHandover.administratorEmail ?? request.adminEmail ?? "";
  const temporaryPassword =
    findDeep(response, PASSWORD_KEY) ?? domHandover.temporaryPassword ?? "";
  const subdomain =
    findDeep(response, /^(subdomain|slug|tenant_slug)$/i) ?? request.subdomain ?? "";
  const code = findDeep(response, /^(code|tenant_code)$/i) ?? request.code ?? subdomain;
  const name = findDeep(response, /^(name|tenant_name|display_name)$/i) ?? request.name ?? code;
  const tenantId =
    findDeep(response, /^(tenant_id|id|uuid)$/i) ?? request.tenantId ?? "";

  const explicitUrl =
    asHttpUrl(findDeep(response, /^(tenant_url|workspace_url|url|primary_domain|hostname|domain)$/i)) ??
    asHttpUrl(domHandover.tenantUrl);

  const derivedUrl = subdomain && baseDomain ? `https://${subdomain}.${baseDomain}` : undefined;
  const tenantUrl = explicitUrl ?? derivedUrl ?? "";

  return {
    tenantId,
    name,
    code: code || subdomain,
    subdomain,
    tenantUrl,
    adminEmail,
    temporaryPassword,
  };
}

/**
 * Completes the university administrator's first login and stores only the
 * permanent password. The one-time temporary password stays in memory.
 * @param browser - Playwright browser
 * @param provision - Normalized handover
 * @param permanentPassword - Password to set
 * @returns The admin email, for persistence
 */
export async function completeUniversityAdminFirstLogin(
  browser: Browser,
  provision: UniversityProvision,
  permanentPassword: string,
): Promise<string> {
  if (!provision.tenantUrl) {
    throw new Error(
      "The provisioned university URL could not be resolved. Check PLATFORM_BASE_DOMAIN or the handover link.",
    );
  }
  if (!provision.adminEmail || !provision.temporaryPassword) {
    throw new Error(
      "The administrator handover did not expose an email and temporary password. " +
        "Capture the `POST /api/v1/enterprise/tenants` response in discovery and update PlatformAdminPage.",
    );
  }

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    const loginPage = new LoginPage(page);
    const setPasswordPage = new SetPasswordPage(page);
    const shellPage = new AuthenticatedShellPage(page);

    const state = await signInAndResolveState(
      loginPage,
      setPasswordPage,
      shellPage,
      provision.adminEmail,
      provision.temporaryPassword,
      provision.tenantUrl,
    );

    if (state === "rejected") {
      throw new Error(
        `The university administrator temporary password was rejected for ${provision.adminEmail}.`,
      );
    }
    if (state === "face-enrollment") {
      throw new Error(
        "The university administrator account unexpectedly requires face enrollment; " +
          "the platform bootstrap expects a standard password first login.",
      );
    }
    if (state === "password-set") {
      await setPasswordPage.setPassword(permanentPassword);
    }

    await expect(shellPage.primaryNavigation).toBeVisible({ timeout: 30_000 });
    await expectAuthenticatedAdmin(page, provision.tenantUrl);
    return provision.adminEmail;
  } finally {
    await context.close();
  }
}

/**
 * Confirms the tenant session is an administrator through the auth API.
 * @param page - Authenticated tenant page
 * @param base - Tenant origin of the newly provisioned university
 */
async function expectAuthenticatedAdmin(page: Page, base: string): Promise<void> {
  const origin = base.replace(/\/+$/, "");
  if (!origin) return;

  const response = await page.request.get(`${origin}/api/v1/auth/me`);
  expect(response.status(), "auth/me after the university admin first login").toBe(200);
  const body = (await response.json()) as Record<string, unknown>;
  const role = String(body.role ?? "");
  expect(role, "university administrator role").toMatch(/admin/i);
}

/**
 * Persists the tenant URL and permanent administrator credentials for the
 * remaining workflow. The temporary password is never written.
 * @param provision - Normalized handover
 * @param adminEmail - University administrator email
 * @param permanentPassword - Permanent password set during first login
 */
export function persistUniversityRuntime(
  provision: UniversityProvision,
  adminEmail: string,
  permanentPassword: string,
): void {
  const tenantUrl = provision.tenantUrl.replace(/\/+$/, "");
  upsertEnv({
    DVS_ALLOW_WRITES: "true",
    DVS_ADMIN_EMAIL: adminEmail,
    DVS_ADMIN_PASSWORD: permanentPassword,
    DVS_TENANT_NAME: provision.name,
    WEB_APP_URL: tenantUrl,
    DVS_WEB_BASE_URL: tenantUrl,
    DVS_API_BASE_URL: tenantUrl,
  });

  saveRunState({
    university: {
      tenantId: provision.tenantId,
      name: provision.name,
      code: provision.code,
      subdomain: provision.subdomain,
      tenantUrl,
      adminEmail,
    },
  });
}
