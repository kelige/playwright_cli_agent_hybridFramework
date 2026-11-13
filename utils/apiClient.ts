import "dotenv/config";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import Ajv, { type ValidateFunction } from "ajv";
import { request, type APIRequestContext, type APIResponse } from "@playwright/test";
import { Routes } from "../api/endpoints/routes";

const SCHEMA_DIR = path.resolve(__dirname, "..", "api", "schemas");

// Schemas carry `format` hints (uuid, date-time) that are not enforced here.
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const validators = new Map<string, ValidateFunction>();

/**
 * Validates a JSON body against `api/schemas/<name>_api_schema.json`.
 * @param name - Schema base name, e.g. `auth_me`
 * @param body - Parsed response body
 * @returns Empty string when valid, otherwise a readable list of violations
 */
export function schemaErrors(name: string, body: unknown): string {
  let validate = validators.get(name);
  if (!validate) {
    const file = path.join(SCHEMA_DIR, `${name}_api_schema.json`);
    validate = ajv.compile(JSON.parse(fs.readFileSync(file, "utf-8")));
    validators.set(name, validate);
  }
  return validate(body)
    ? ""
    : (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
}

/** Origin-only API base URL from `.env`, or empty when not configured. */
export function apiBaseUrl(): string {
  return (process.env.DVS_API_BASE_URL ?? "").replace(/\/+$/, "");
}

/** Builds the login body observed in captured traffic. */
export function loginBody(email: string, password: string) {
  return {
    email,
    password,
    device_id: randomUUID(),
    device_label: "Win32 · Browser",
    platform: "Win32",
    browser: "Playwright API Test",
  };
}

/** Creates an unauthenticated request context bound to the API base URL. */
export async function newApiContext(): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: `${apiBaseUrl()}/`,
    ignoreHTTPSErrors: true,
    // Origin/Referer are required by the backend CSRF check on state-changing calls.
    extraHTTPHeaders: {
      Accept: "application/json",
      Origin: apiBaseUrl(),
      Referer: `${apiBaseUrl()}/`,
    },
  });
}

/** Header carrying the `csrftoken` cookie value; required on authenticated POST/PUT calls. */
export async function csrfHeaders(api: APIRequestContext): Promise<Record<string, string>> {
  const cookie = (await api.storageState()).cookies.find((c) => c.name === "csrftoken");
  return cookie ? { "X-CSRFToken": cookie.value } : {};
}

/**
 * Logs in through AUTH_LOGIN. The returned context holds the session cookie.
 * @returns The authenticated context and the raw login response
 */
export async function loginContext(
  email: string,
  password: string,
): Promise<{ api: APIRequestContext; response: APIResponse }> {
  const api = await newApiContext();
  const response = await api.post(Routes.AUTH_LOGIN.replace(/^\//, ""), {
    data: loginBody(email, password),
  });
  return { api, response };
}

/** Strips a leading slash so paths resolve under the baseURL origin. */
export function rel(route: string): string {
  return route.replace(/^\//, "");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

/**
 * Authenticated cookie-session client for one DVS user.
 * Every write carries the CSRF header and a fresh Idempotency-Key, which the
 * backend requires on some routes (paper submit) and accepts on the rest.
 */
export class ApiSession {
  private constructor(
    readonly api: APIRequestContext,
    readonly email: string,
    readonly loginResponse: APIResponse,
  ) {}

  /** Logs in and keeps the session cookie. Check `loginResponse` for the outcome. */
  static async login(email: string, password: string): Promise<ApiSession> {
    const { api, response } = await loginContext(email, password);
    return new ApiSession(api, email, response);
  }

  private async writeHeaders(): Promise<Record<string, string>> {
    return { ...(await csrfHeaders(this.api)), "Idempotency-Key": randomUUID() };
  }

  get(route: string): Promise<APIResponse> {
    return this.api.get(rel(route));
  }

  async post(route: string, data: unknown = {}): Promise<APIResponse> {
    return this.api.post(rel(route), { data, headers: await this.writeHeaders() });
  }

  async put(route: string, data: unknown): Promise<APIResponse> {
    return this.api.put(rel(route), { data, headers: await this.writeHeaders() });
  }

  /** Multipart PDF upload used by the paper document routes. */
  async uploadPdf(route: string, filePath: string): Promise<APIResponse> {
    return this.api.post(rel(route), {
      headers: await this.writeHeaders(),
      multipart: {
        file: { name: path.basename(filePath), mimeType: "application/pdf", buffer: fs.readFileSync(filePath) },
      },
    });
  }

  /** Re-verifies the account with its own password; required before sensitive actions. */
  stepUp(password: string): Promise<APIResponse> {
    return this.post(Routes.AUTH_STEP_UP, { password });
  }

  dispose(): Promise<void> {
    return this.api.dispose();
  }
}

/**
 * Asserts an HTTP 200 and returns the parsed JSON body.
 * The failure message carries the status and path, never request secrets.
 */
export async function okJson<T = Json>(response: APIResponse, label: string): Promise<T> {
  const text = await response.text();
  if (response.status() !== 200) {
    throw new Error(`${label}: expected 200, got ${response.status()} - ${text.slice(0, 400)}`);
  }
  return JSON.parse(text) as T;
}

/**
 * First-login handover: signs in with the single-use temporary password, sets the
 * permanent password and returns a session authenticated with it.
 */
export async function completeFirstLogin(
  email: string,
  temporaryPassword: string,
  permanentPassword: string,
): Promise<ApiSession> {
  const first = await ApiSession.login(email, temporaryPassword);
  if (first.loginResponse.status() !== 200) {
    throw new Error(`first login for ${email} failed with ${first.loginResponse.status()}`);
  }
  const setup = await okJson<Json>(
    await first.post(Routes.AUTH_PASSWORD_COMPLETE_SETUP, { new_password: permanentPassword }),
    `complete password setup for ${email}`,
  );
  if (setup.ok !== true) {
    throw new Error(`password setup for ${email} did not return ok`);
  }
  await first.dispose();

  const session = await ApiSession.login(email, permanentPassword);
  if (session.loginResponse.status() !== 200) {
    throw new Error(`login with the permanent password failed for ${email}`);
  }
  return session;
}
