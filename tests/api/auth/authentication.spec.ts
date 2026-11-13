import "dotenv/config";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { Routes } from "../../../api/endpoints/routes";
import { csrfHeaders, loginContext, newApiContext, rel, schemaErrors } from "../../../utils/apiClient";

const email = process.env.DVS_ADMIN_EMAIL ?? "";
const password = process.env.DVS_ADMIN_PASSWORD ?? "";

test.describe("DVS API - Authentication @master @api", () => {
  test.skip(!process.env.DVS_API_BASE_URL, "Set DVS_API_BASE_URL in .env.");
  test.skip(!email || !password, "Set DVS_ADMIN_EMAIL and DVS_ADMIN_PASSWORD in .env.");

  let admin: APIRequestContext;

  test.beforeAll(async () => {
    const login = await loginContext(email, password);
    expect(login.response.status(), "admin login in beforeAll").toBe(200);
    admin = login.api;
  });

  test.afterAll(async () => {
    await admin?.dispose();
  });

  test("successful login returns user and session cookie @sanity @regression", async () => {
    const { api, response } = await loginContext(email, password);

    await test.step("1) login returns 200 and matches schema", async () => {
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(schemaErrors("auth_login", body)).toBe("");
      expect(body.user.email.toLowerCase()).toBe(email.toLowerCase());
    });

    await test.step("2) response never echoes the password", async () => {
      expect(await response.text()).not.toContain(password);
    });

    await test.step("3) session cookie is set and AUTH_ME returns the same identity", async () => {
      const cookies = (await api.storageState()).cookies;
      expect(cookies.length).toBeGreaterThan(0);
      const me = await api.get(rel(Routes.AUTH_ME));
      expect(me.status()).toBe(200);
      const meBody = await me.json();
      expect(schemaErrors("auth_me", meBody)).toBe("");
      expect(meBody.user.email.toLowerCase()).toBe(email.toLowerCase());
    });

    await api.dispose();
  });

  test("invalid password is rejected with 401 @regression", async () => {
    // One failed attempt only: the account locks after failed_login_limit (observed 6).
    const { api, response } = await loginContext(email, `${password}-wrong`);

    await test.step("1) login returns 401 with a detail message", async () => {
      expect(response.status()).toBe(401);
      // Wording differs per tenant ("Invalid email or password" vs "Unable to sign in...").
      const body = await response.json();
      expect(typeof body.detail).toBe("string");
      expect(body.detail.length).toBeGreaterThan(0);
    });

    await test.step("2) AUTH_ME stays unauthenticated", async () => {
      expect((await api.get(rel(Routes.AUTH_ME))).status()).toBe(401);
    });

    await api.dispose();
  });

  test("missing credentials are rejected @regression", async () => {
    const api = await newApiContext();
    const response = await api.post(rel(Routes.AUTH_LOGIN), { data: {} });
    expect([400, 401, 422]).toContain(response.status());
    await api.dispose();
  });

  test("csrf token is issued @regression", async () => {
    const response = await admin.get(rel(Routes.AUTH_CSRF));
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(schemaErrors("auth_csrf", body)).toBe("");
    expect(body.csrf_token.length).toBeGreaterThan(0);
  });

  test("sso providers returns an array @regression", async () => {
    const response = await admin.get(rel(Routes.AUTH_SSO_PROVIDERS));
    expect(response.status()).toBe(200);
    expect(Array.isArray(await response.json())).toBe(true);
  });

  test("notifications return counter and items @regression", async () => {
    const response = await admin.get(rel(Routes.AUTH_NOTIFICATIONS));
    test.skip(response.status() === 502, "Degraded upstream (502) on notifications; not a functional pass.");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(schemaErrors("auth_notifications", body)).toBe("");
    expect(typeof body.unread_count).toBe("number");
    expect(Array.isArray(body.items)).toBe(true);
  });

  test("security context is readable @regression", async () => {
    const response = await admin.get(rel(Routes.AUTH_SECURITY_CONTEXT));
    expect(response.status()).toBe(200);
    expect(schemaErrors("auth_security_context", await response.json())).toBe("");
  });

  test("logout invalidates the session @sanity @regression", async () => {
    const { api, response } = await loginContext(email, password);
    expect(response.status()).toBe(200);

    await test.step("1) logout returns ok", async () => {
      const logout = await api.post(rel(Routes.AUTH_LOGOUT), { headers: await csrfHeaders(api) });
      expect(logout.status()).toBe(200);
      const body = await logout.json();
      expect(schemaErrors("auth_logout", body)).toBe("");
      expect(body.ok).toBe(true);
    });

    await test.step("2) AUTH_ME returns 401 afterwards", async () => {
      expect((await api.get(rel(Routes.AUTH_ME))).status()).toBe(401);
    });

    await api.dispose();
  });
});
