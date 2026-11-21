import "dotenv/config";
import { randomUUID } from "node:crypto";
import { request, type APIRequestContext, type APIResponse } from "@playwright/test";
import { PlatformRoutes } from "../api/endpoints/platformRoutes";

/** Values the platform control plane returns after a university is provisioned. */
export type PlatformUniversityHandover = {
  tenantId: string;
  institutionId: string;
  name: string;
  code: string;
  hostname: string;
  tenantUrl: string;
  adminEmail: string;
  adminUserId: number;
  temporaryPassword: string;
};

/** Request body accepted by `POST /api/v1/enterprise/tenants`. */
export type PlatformProvisionRequest = {
  name: string;
  code: string;
  adminEmail: string;
  adminFirstName: string;
  adminLastName: string;
  plan?: string;
};

/** Origin of the platform control plane from `.env`. */
export function platformBaseUrl(): string {
  return (process.env.PLATFORM_API_BASE_URL ?? process.env.PLATFORM_URL ?? "").replace(/\/+$/, "");
}

/** Strips a leading slash so a route resolves under the context base URL. */
function rel(route: string): string {
  return route.replace(/^\//, "");
}

/**
 * Authenticated session on the platform control plane.
 * A platform token cannot call tenant routes, so nothing here touches a university.
 */
export class PlatformSession {
  private constructor(
    readonly api: APIRequestContext,
    readonly loginResponse: APIResponse,
  ) {}

  /**
   * Signs in to the platform console. Faces the same device-tagged login body
   * the console posts, so the response matches a real browser session.
   * @param email - `PLATFORM_ADMIN_EMAIL`
   * @param password - `PLATFORM_ADMIN_PASSWORD`
   */
  static async login(email: string, password: string): Promise<PlatformSession> {
    const base = platformBaseUrl();
    if (!base) throw new Error("Set PLATFORM_URL (or PLATFORM_API_BASE_URL) to the platform console.");

    const api = await request.newContext({
      baseURL: `${base}/`,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: {
        Accept: "application/json",
        Origin: base,
        Referer: `${base}/`,
      },
    });

    const response = await api.post(rel(PlatformRoutes.AUTH_LOGIN), {
      data: {
        email,
        password,
        device_id: randomUUID(),
        device_label: "Win32 · Platform Bootstrap",
        platform: "Win32",
        browser: "Playwright Platform Bootstrap",
      },
    });
    return new PlatformSession(api, response);
  }

  /** Header carrying the `csrftoken` cookie value; required on every write. */
  private async csrfHeaders(): Promise<Record<string, string>> {
    const state = await this.api.storageState();
    const token = state.cookies.find((cookie) => cookie.name === "csrftoken")?.value;
    return token ? { "X-CSRFToken": token } : {};
  }

  private async writeHeaders(): Promise<Record<string, string>> {
    return { ...(await this.csrfHeaders()), "Idempotency-Key": randomUUID() };
  }

  get(route: string): Promise<APIResponse> {
    return this.api.get(rel(route));
  }

  async post(route: string, data: unknown = {}): Promise<APIResponse> {
    return this.api.post(rel(route), { data, headers: await this.writeHeaders() });
  }

  async patch(route: string, data: unknown = {}): Promise<APIResponse> {
    return this.api.patch(rel(route), { data, headers: await this.writeHeaders() });
  }

  dispose(): Promise<void> {
    return this.api.dispose();
  }
}

/**
 * Returns the next sequential university number.
 *
 * Existing tenants are read from the control plane and the highest
 * `Automation testing -N` wins, so a run never reuses or guesses a number and
 * the name stays easy to recognise in the console.
 * @param session - Authenticated platform session
 * @returns The next number, starting at 1
 */
export async function nextUniversityNumber(session: PlatformSession): Promise<number> {
  const response = await session.get(PlatformRoutes.ENTERPRISE_TENANTS);
  if (!response.ok()) {
    throw new Error(`Reading the tenant list failed (${response.status()}).`);
  }
  const rows = (await response.json()) as Array<Record<string, unknown>>;
  let highest = 0;
  for (const row of rows) {
    const match = /^Automation testing -(\d+)$/i.exec(String(row.name ?? "").trim());
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
}

/**
 * Provisions a university and returns the one-time administrator handover.
 * The console issues a fresh tenant on every call, so each run gets a clean
 * university instead of reusing another run's data.
 * @param session - Authenticated platform session
 * @param payload - University and administrator details
 * @returns Normalized handover, including the one-time temporary password
 */
export async function provisionUniversity(
  session: PlatformSession,
  payload: PlatformProvisionRequest,
): Promise<PlatformUniversityHandover> {
  const response = await session.post(PlatformRoutes.ENTERPRISE_TENANTS, {
    name: payload.name,
    code: payload.code,
    admin_email: payload.adminEmail,
    admin_first_name: payload.adminFirstName,
    admin_last_name: payload.adminLastName,
    ...(payload.plan ? { plan: payload.plan } : {}),
  });

  const text = await response.text();
  if (!response.ok()) {
    throw new Error(
      `Provisioning ${payload.code} failed (${response.status()}): ${text.slice(0, 400)}`,
    );
  }

  const body = JSON.parse(text) as Record<string, unknown>;
  const hostname = String(body.hostname ?? "");
  const baseDomain = (process.env.PLATFORM_BASE_DOMAIN ?? "").replace(/^\.+|\.+$/g, "");
  const tenantUrl = hostname
    ? `https://${hostname.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`
    : baseDomain
      ? `https://${payload.code}.${baseDomain}`
      : "";

  const handover: PlatformUniversityHandover = {
    tenantId: String(body.id ?? ""),
    institutionId: String(body.institution_id ?? ""),
    name: String(body.name ?? payload.name),
    code: String(body.code ?? payload.code),
    hostname,
    tenantUrl,
    adminEmail: String(body.admin_email ?? payload.adminEmail),
    adminUserId: Number(body.admin_user_id ?? 0),
    temporaryPassword: String(body.temporary_password ?? ""),
  };

  if (!handover.tenantUrl) {
    throw new Error(
      `Provisioning ${payload.code} returned no hostname. Check PLATFORM_BASE_DOMAIN.`,
    );
  }
  if (!handover.temporaryPassword) {
    throw new Error(
      `Provisioning ${payload.code} returned no temporary_password; the Admin first login cannot proceed.`,
    );
  }
  return handover;
}
