import "dotenv/config";
import { expect, test } from "@playwright/test";
import { PlatformSession, platformBaseUrl } from "../../../utils/platformClient";
import { check } from "../../../utils/defectLog";

/**
 * Platform Admin test cases — docs/testcases/01-platform-admin.csv.
 *
 * The provisioning path (PAC-06..PAC-11) is exercised by `npm run test:platform`
 * on every run; the cases here are read-only plus the validation and
 * authorization negatives, so running the test-case suite never litters the
 * platform with throwaway universities. Set PLATFORM_TESTCASE_PROVISION=true to
 * also exercise live creation.
 */

const platformUrl = platformBaseUrl();
const email = process.env.PLATFORM_ADMIN_EMAIL ?? "";
const password = process.env.PLATFORM_ADMIN_PASSWORD ?? "";
const allowProvision = process.env.PLATFORM_TESTCASE_PROVISION === "true";
const runId = Date.now().toString(36).toLowerCase();

test.describe("Platform Admin test cases", () => {
  test.skip(!platformUrl, "Set PLATFORM_URL to the platform console.");
  test.skip(!email || !password, "Set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD.");

  test("PAC-01/05 platform sign-in and tenant list @platform-admin @testcase", async () => {
    await check(
      "PAC-01",
      {
        role: "platform-admin",
        area: "authentication",
        severity: "S1",
        title: "The platform administrator cannot sign in",
        expected: "200 and an authenticated platform session",
      },
      async () => {
        const session = await PlatformSession.login(email, password);
        try {
          expect(session.loginResponse.status()).toBe(200);
        } finally {
          await session.dispose();
        }
      },
    );

    await check(
      "PAC-05",
      {
        role: "platform-admin",
        area: "tenants",
        severity: "S1",
        title: "The tenant list is not readable",
        expected: "200 with an array of universities",
      },
      async () => {
        const session = await PlatformSession.login(email, password);
        try {
          const response = await session.get("/api/v1/enterprise/tenants");
          expect(response.status()).toBe(200);
          const body = (await response.json()) as unknown;
          expect(Array.isArray(body)).toBe(true);
          const rows = body as Array<Record<string, unknown>>;
          expect(rows.length).toBeGreaterThan(0);
          for (const row of rows.slice(0, 5)) {
            expect(row).toHaveProperty("id");
            expect(row).toHaveProperty("name");
            expect(row).toHaveProperty("code");
          }
        } finally {
          await session.dispose();
        }
      },
    );
  });

  test("PAC-02/03/04 invalid sign-in is refused @platform-admin @testcase", async () => {
    await check(
      "PAC-02",
      {
        role: "platform-admin",
        area: "authentication",
        severity: "S1",
        title: "A wrong platform password is accepted",
        expected: "401 and no session",
      },
      async () => {
        const session = await PlatformSession.login(email, `${password}-wrong`);
        try {
          expect(session.loginResponse.status()).toBe(401);
        } finally {
          await session.dispose();
        }
      },
    );

    await check(
      "PAC-03",
      {
        role: "platform-admin",
        area: "authentication",
        severity: "S2",
        title: "An unknown platform account is disclosed or accepted",
        expected: "401 without revealing account existence",
      },
      async () => {
        const session = await PlatformSession.login(`unknown.${runId}@example.invalid`, "WrongPass1!");
        try {
          expect([401, 422]).toContain(session.loginResponse.status());
          expect((await session.loginResponse.text()).toLowerCase()).not.toContain("no such user");
        } finally {
          await session.dispose();
        }
      },
    );

    await check(
      "PAC-04",
      {
        role: "platform-admin",
        area: "authentication",
        severity: "S2",
        title: "Empty credentials reach the authentication layer",
        expected: "400/401 without creating a session",
      },
      async () => {
        const session = await PlatformSession.login("", "");
        try {
          expect([400, 401, 422]).toContain(session.loginResponse.status());
        } finally {
          await session.dispose();
        }
      },
    );
  });

  test("PAC-16 anonymous provisioning is refused @platform-admin @testcase", async () => {
    await check(
      "PAC-16",
      {
        role: "platform-admin",
        area: "authorization",
        severity: "S1",
        title: "A university can be provisioned without a session",
        expected: "401/403 and no tenant created",
      },
      async () => {
        const { request } = await import("@playwright/test");
        const api = await request.newContext({
          baseURL: `${platformUrl}/`,
          ignoreHTTPSErrors: true,
        });
        try {
          const response = await api.post("/api/v1/enterprise/tenants", {
            data: { name: `Anonymous ${runId}`, code: `anon-${runId}`, admin_email: `anon.${runId}@example.com` },
          });
          expect([401, 403, 422]).toContain(response.status());
        } finally {
          await api.dispose();
        }
      },
    );

    await check(
      "PAC-17",
      {
        role: "platform-admin",
        area: "authorization",
        severity: "S1",
        title: "A tenant session can read the control plane",
        expected: "refused for a tenant administrator",
      },
      async () => {
        const tenant = (process.env.WEB_APP_URL ?? "").replace(/\/+$/, "");
        if (!tenant) throw new Error("No tenant configured; the workflow has not run yet.");
        const { ApiSession } = await import("../../../utils/apiClient");
        const admin = await ApiSession.login(
          process.env.DVS_ADMIN_EMAIL ?? "",
          process.env.DVS_ADMIN_PASSWORD ?? "",
        );
        try {
          const response = await admin.api.get("/api/v1/enterprise/tenants");
          expect([401, 403, 404]).toContain(response.status());
        } finally {
          await admin.dispose();
        }
      },
    );
  });

  test("PAC-12..15 provisioning validation @platform-admin @testcase", async () => {
    test.skip(
      !allowProvision,
      "Set PLATFORM_TESTCASE_PROVISION=true to exercise live tenant creation validation.",
    );

    await check(
      "PAC-12/13/14/15",
      {
        role: "platform-admin",
        area: "tenants",
        severity: "S2",
        title: "Provisioning validation is missing",
        expected: "duplicate code, missing name, missing email and malformed email all rejected",
      },
      async () => {
        const session = await PlatformSession.login(email, password);
        try {
          const base = {
            name: `Validation ${runId}`,
            code: `validation-${runId}`,
            adminEmail: `validation.${runId}@example.com`,
            adminFirstName: "Validation",
            adminLastName: "Admin",
          };
          const created = await session.post("/api/v1/enterprise/tenants", {
            name: base.name,
            code: base.code,
            admin_email: base.adminEmail,
            admin_first_name: base.adminFirstName,
            admin_last_name: base.adminLastName,
          });
          expect(created.status()).toBe(200);

          const duplicate = await session.post("/api/v1/enterprise/tenants", {
            name: base.name,
            code: base.code,
            admin_email: `validation2.${runId}@example.com`,
            admin_first_name: "Validation",
            admin_last_name: "Admin",
          });
          expect(duplicate.status()).toBeGreaterThanOrEqual(400);

          const missingName = await session.post("/api/v1/enterprise/tenants", {
            code: `noname-${runId}`,
            admin_email: `noname.${runId}@example.com`,
          });
          expect(missingName.status()).toBeGreaterThanOrEqual(400);

          const missingEmail = await session.post("/api/v1/enterprise/tenants", {
            name: `No Email ${runId}`,
            code: `noemail-${runId}`,
          });
          expect(missingEmail.status()).toBeGreaterThanOrEqual(400);

          const malformed = await session.post("/api/v1/enterprise/tenants", {
            name: `Malformed ${runId}`,
            code: `malformed-${runId}`,
            admin_email: "not-an-email",
          });
          expect(malformed.status()).toBeGreaterThanOrEqual(400);
        } finally {
          await session.dispose();
        }
      },
    );
  });

  test("PAC-29 malformed JSON does not break the control plane @platform-admin @testcase", async () => {
    await check(
      "PAC-29",
      {
        role: "platform-admin",
        area: "resilience",
        severity: "S3",
        title: "Malformed JSON returns a server error",
        expected: "400, not 500, and the service stays healthy",
      },
      async () => {
        const session = await PlatformSession.login(email, password);
        try {
          const state = await session.api.storageState();
          const csrf = state.cookies.find((cookie) => cookie.name === "csrftoken")?.value ?? "";
          const response = await session.api.fetch("/api/v1/enterprise/tenants", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-CSRFToken": csrf },
            data: "{not-json",
          });
          expect(response.status()).toBeLessThan(500);
        } finally {
          await session.dispose();
        }
      },
    );
  });
});
