import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, request, test } from "@playwright/test";
import { PlatformRoutes, PlatformRouteBuilders } from "../../../api/endpoints/platformRoutes";
import { Routes } from "../../../api/endpoints/routes";
import { ApiSession, okJson, type Json } from "../../../utils/apiClient";
import { runCase } from "../../../utils/caseRunner";
import { PlatformSession, platformBaseUrl } from "../../../utils/platformClient";
import { roleCredentials } from "../../../utils/roleSignIn";

/**
 * Platform Admin API cases — docs/testcases/01-platform-admin.csv.
 * Read-only and refusal checks only; provisioning and destructive mutations
 * stay in `npm run test:platform` and explicit write-gated workflows.
 */

const platformUrl = platformBaseUrl();
const email = process.env.PLATFORM_ADMIN_EMAIL ?? "";
const password = process.env.PLATFORM_ADMIN_PASSWORD ?? "";
const admin = roleCredentials("admin");
const tenantOrigin = (process.env.WEB_APP_URL ?? "").replace(/\/+$/, "");
const rel = (route: string) => route.replace(/^\//, "");

test.describe("Platform Admin API test cases", () => {
  test.skip(!platformUrl, "Set PLATFORM_URL to the platform console.");
  test.skip(!email || !password, "Set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD.");

  async function platform(): Promise<PlatformSession> {
    const session = await PlatformSession.login(email, password);
    expect(session.loginResponse.status(), "platform login").toBe(200);
    return session;
  }

  async function tenantRow(session: PlatformSession): Promise<Json> {
    const response = await session.get(PlatformRoutes.ENTERPRISE_TENANTS);
    expect(response.status(), "tenant list").toBe(200);
    const rows = (await response.json()) as Json[];
    const wanted = process.env.DVS_TENANT_NAME ?? "";
    return (
      rows.find((row) => String(row.name ?? "") === wanted) ??
      rows.find((row) => String(row.hostname ?? "").includes("automation-testing")) ??
      rows[0] ??
      {}
    );
  }

  test("PAC-024 tenant list is readable @platform-admin @testcase @api", async () => {
    const session = await platform();
    try {
      await runCase(
        "PAC-024",
        {
          title: "Tenant list is not readable",
          expected: "200 with an array of tenant rows containing id, name and code",
        },
        async () => {
          const response = await session.get(PlatformRoutes.ENTERPRISE_TENANTS);
          expect(response.status()).toBe(200);
          const rows = (await response.json()) as Json[];
          expect(Array.isArray(rows)).toBe(true);
          expect(rows.length).toBeGreaterThan(0);
          for (const row of rows.slice(0, 5)) {
            expect(row).toHaveProperty("id");
            expect(row).toHaveProperty("name");
            expect(row).toHaveProperty("code");
          }
        },
      );
    } finally {
      await session.dispose();
    }
  });

  test("PAC-055 type-confused login payload is refused @platform-admin @testcase @api", async () => {
    await runCase(
      "PAC-055",
      {
        title: "Type-confused login payload is accepted",
        expected: "4xx validation refusal; no authenticated session",
      },
      async () => {
        const api = await request.newContext({
          baseURL: `${platformUrl}/`,
          ignoreHTTPSErrors: true,
          extraHTTPHeaders: { Accept: "application/json", Origin: platformUrl, Referer: `${platformUrl}/` },
        });
        try {
          const response = await api.post(rel(PlatformRoutes.AUTH_LOGIN), {
            data: { email: { nested: true }, password: ["array"] },
          });
          expect([400, 401, 422]).toContain(response.status());
        } finally {
          await api.dispose();
        }
      },
    );
  });

  test("PAC-059/100/104/111/118/119 tenant session cannot use the control plane @platform-admin @testcase @api", async () => {
    test.skip(!admin.email || !admin.password, "The provisioned Admin credentials are missing.");
    const session = await ApiSession.login(admin.email, admin.password);
    expect(session.loginResponse.status(), "tenant admin login").toBe(200);
    const foreignTenant = randomUUID();

    try {
      await runCase(
        "PAC-059",
        {
          title: "Tenant administrator can provision a university",
          expected: "401/403/404 refusal from the tenant origin",
        },
        async () => {
          const response = await session.post(PlatformRoutes.ENTERPRISE_TENANTS, {
            name: `Illegal ${Date.now()}`,
            code: `illegal-${Date.now()}`,
            admin_email: `illegal.${Date.now()}@example.com`,
            admin_first_name: "Illegal",
            admin_last_name: "Admin",
          });
          expect([401, 403, 404, 422]).toContain(response.status());
        },
      );

      await runCase(
        "PAC-100",
        {
          title: "Tenant administrator can switch the control-plane context",
          expected: "401/403/404 refusal",
        },
        async () => {
          const response = await session.post(PlatformRoutes.ENTERPRISE_TENANT_SWITCH, {
            tenant_id: foreignTenant,
          });
          expect([401, 403, 404, 409, 422]).toContain(response.status());
        },
      );

      await runCase(
        "PAC-104",
        {
          title: "Control-plane overview is readable from a tenant session",
          expected: "401/403/404 refusal",
        },
        async () => {
          const response = await session.get(PlatformRoutes.ENTERPRISE_CONTROL_PLANE);
          expect([401, 403, 404]).toContain(response.status());
        },
      );

      await runCase(
        "PAC-111",
        {
          title: "Audit trail is readable from a tenant session",
          expected: "401/403/404 refusal",
        },
        async () => {
          const response = await session.get(PlatformRouteBuilders.controlPlaneAudit(5));
          expect([401, 403, 404]).toContain(response.status());
        },
      );

      await runCase(
        "PAC-118",
        {
          title: "Institution estate list is readable from a tenant session",
          expected: "401/403/404 refusal",
        },
        async () => {
          const response = await session.get(PlatformRoutes.ENTERPRISE_INSTITUTIONS);
          expect([401, 403, 404]).toContain(response.status());
        },
      );

      await runCase(
        "PAC-119",
        {
          title: "Tenant session can mutate another tenant",
          expected: "401/403/404 refusal and no state change",
        },
        async () => {
          const response = await session.api.patch(
            rel(PlatformRouteBuilders.tenant(foreignTenant)),
            { data: { name: "hijacked" } },
          );
          expect([401, 403, 404]).toContain(response.status());
        },
      );
    } finally {
      await session.dispose();
    }
  });

  test("PAC-086 permanent password grants the administrator role @platform-admin @testcase @api", async () => {
    test.skip(!admin.email || !admin.password, "The provisioned Admin credentials are missing.");
    await runCase(
      "PAC-086",
      {
        title: "Permanent password does not grant the administrator role",
        expected: "200 and an administrator role from auth/me",
      },
      async () => {
        const session = await ApiSession.login(admin.email, admin.password);
        try {
          expect(session.loginResponse.status()).toBe(200);
          const me = await okJson(await session.get(Routes.AUTH_ME), "auth/me");
          expect(String(me.role)).toMatch(/admin/i);
        } finally {
          await session.dispose();
        }
      },
    );
  });

  test("PAC-090/093 tenant update guards @platform-admin @testcase @api", async () => {
    const session = await platform();
    try {
      await runCase(
        "PAC-090",
        {
          title: "Unknown tenant id is not refused on update",
          expected: "400/404 for an unknown tenant id",
        },
        async () => {
          const response = await session.patch(PlatformRouteBuilders.tenant(randomUUID()), {
            name: "does-not-exist",
          });
          expect([400, 404, 422]).toContain(response.status());
        },
      );

      await runCase(
        "PAC-093",
        {
          title: "University update succeeds without a CSRF token",
          expected: "401/403 refusal when X-CSRFToken is absent",
        },
        async () => {
          const row = await tenantRow(session);
          if (!row.id) throw new Error("No tenant available for the CSRF update case.");
          const response = await session.api.patch(
            rel(PlatformRouteBuilders.tenant(String(row.id))),
            { data: { name: String(row.name ?? "") } },
          );
          expect([401, 403]).toContain(response.status());
        },
      );
    } finally {
      await session.dispose();
    }
  });

  test("PAC-102/105/112/115/125 control-plane reads @platform-admin @testcase @api", async () => {
    const session = await platform();
    try {
      await runCase(
        "PAC-102",
        {
          title: "Control-plane overview is not readable",
          expected: "200 with a control-plane overview object",
        },
        async () => {
          const response = await session.get(PlatformRoutes.ENTERPRISE_CONTROL_PLANE);
          expect(response.status()).toBe(200);
          const body = (await response.json()) as Json;
          expect(body).toBeTruthy();
          expect(typeof body).toBe("object");
        },
      );

      await runCase(
        "PAC-105",
        {
          title: "Audit trail is not readable with an explicit limit",
          expected: "200 and at most the requested number of entries",
        },
        async () => {
          const response = await session.get(PlatformRouteBuilders.controlPlaneAudit(5));
          expect(response.status()).toBe(200);
          const body = (await response.json()) as Json;
          const events = Array.isArray(body) ? body : (body.events ?? body.entries ?? body.items);
          expect(Array.isArray(events), "audit entries").toBe(true);
          expect((events as Json[]).length).toBeLessThanOrEqual(5);
        },
      );

      await runCase(
        "PAC-112",
        {
          title: "Institution estate list is not readable",
          expected: "200 with an array of institutions",
        },
        async () => {
          const response = await session.get(PlatformRoutes.ENTERPRISE_INSTITUTIONS);
          expect(response.status()).toBe(200);
          expect(Array.isArray(await response.json())).toBe(true);
        },
      );

      await runCase(
        "PAC-115",
        {
          title: "Domain context does not resolve a tenant hostname",
          expected: "200 with the resolved tenant context",
        },
        async () => {
          const row = await tenantRow(session);
          const hostname = String(row.hostname ?? tenantOrigin.replace(/^https?:\/\//, ""));
          if (!hostname) throw new Error("No tenant hostname available for the domain-context case.");
          const response = await session.get(
            `${PlatformRoutes.ENTERPRISE_DOMAIN_CONTEXT}?hostname=${encodeURIComponent(hostname)}`,
          );
          expect(response.status()).toBe(200);
          const body = (await response.json()) as Json;
          expect(body).toBeTruthy();
        },
      );

      await runCase(
        "PAC-125",
        {
          title: "Tenant list rejects or changes shape for unknown query parameters",
          expected: "unknown parameters are ignored; same tenant rows are returned",
        },
        async () => {
          const clean = await session.get(PlatformRoutes.ENTERPRISE_TENANTS);
          const noisy = await session.get(`${PlatformRoutes.ENTERPRISE_TENANTS}?unknown=1`);
          expect(noisy.status()).toBe(200);
          const cleanRows = (await clean.json()) as Json[];
          const noisyRows = (await noisy.json()) as Json[];
          expect(noisyRows.length).toBe(cleanRows.length);
        },
      );
    } finally {
      await session.dispose();
    }
  });

  test("PAC-120 platform session cannot read tenant workspace APIs @platform-admin @testcase @api", async () => {
    test.skip(!tenantOrigin, "Set WEB_APP_URL to a provisioned tenant.");
    const session = await platform();
    try {
      await runCase(
        "PAC-120",
        {
          title: "Platform session can read tenant workspace APIs",
          expected: "401/403/404 when the platform session calls a tenant route",
        },
        async () => {
          const response = await session.api.get(`${tenantOrigin}${Routes.CONFIGURATION_CATALOG}`);
          expect([401, 403, 404]).toContain(response.status());
        },
      );
    } finally {
      await session.dispose();
    }
  });

  test("PAC-124 revoked platform session cannot be replayed @platform-admin @testcase @api", async () => {
    const session = await platform();
    try {
      await runCase(
        "PAC-124",
        {
          title: "Revoked session can be replayed",
          expected: "the tenant list is refused after logout",
        },
        async () => {
          const logout = await session.post("/api/v1/auth/logout");
          expect([200, 204]).toContain(logout.status());
          const response = await session.get(PlatformRoutes.ENTERPRISE_TENANTS);
          expect([401, 403]).toContain(response.status());
        },
      );
    } finally {
      await session.dispose();
    }
  });
});
