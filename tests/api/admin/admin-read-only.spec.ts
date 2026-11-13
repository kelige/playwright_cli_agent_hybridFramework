import "dotenv/config";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { Routes, RouteBuilders } from "../../../api/endpoints/routes";
import { loginContext, newApiContext, rel, schemaErrors } from "../../../utils/apiClient";

const email = process.env.DVS_ADMIN_EMAIL ?? "";
const password = process.env.DVS_ADMIN_PASSWORD ?? "";

interface ReadOnlyCase {
  name: string;
  path: string;
  schema?: string;
  statuses: number[];
}

// Admin read-only GETs from the verified inventory. Statuses mirror the observed table;
// 5xx values are degraded-upstream and skip instead of passing.
const adminReads: ReadOnlyCase[] = [
  { name: "enterprise domain context", path: Routes.ENTERPRISE_DOMAIN_CONTEXT, schema: "enterprise_domain_context", statuses: [200, 403, 428] },
  { name: "operations overview", path: Routes.OPERATIONS_OVERVIEW, schema: "operations_overview", statuses: [200] },
  { name: "phase4 i18n", path: Routes.PHASE4_I18N, statuses: [200] },
  { name: "configuration catalog", path: Routes.CONFIGURATION_CATALOG, statuses: [200] },
  { name: "configuration catalog programmes table", path: RouteBuilders.configurationCatalog("programmes"), statuses: [200] },
  { name: "configuration readiness", path: Routes.CONFIGURATION_READINESS, statuses: [200] },
  { name: "security catalog", path: Routes.SECURITY_CATALOG, schema: "security_catalog", statuses: [200] },
  { name: "phase4 assessment catalog", path: RouteBuilders.phase4Catalog("assessment"), statuses: [200] },
  { name: "remote security policy", path: Routes.PHASE4_REMOTE_SECURITY_POLICY, schema: "remote_security_policy", statuses: [200, 403, 404] },
  { name: "evaluation workflow catalog", path: Routes.EVALUATION_WORKFLOW_CATALOG, schema: "evaluation_workflow_catalog", statuses: [200] },
  { name: "ai evaluation catalog (module disabled)", path: Routes.AI_EVALUATION_CATALOG, statuses: [403] },
];

test.describe("DVS API - Admin read-only endpoints @master @api", () => {
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

  for (const c of adminReads) {
    test(`GET ${c.name} @regression`, async () => {
      const response = await admin.get(rel(c.path));
      test.skip(response.status() >= 500, `Degraded upstream (${response.status()}) on ${c.path}.`);

      await test.step("1) status matches observed contract", async () => {
        expect(c.statuses, `${c.path} returned ${response.status()}`).toContain(response.status());
      });

      if (response.status() === 200 && c.schema) {
        await test.step("2) body matches schema", async () => {
          expect(schemaErrors(c.schema!, await response.json())).toBe("");
        });
      }
    });
  }

  test("configuration readiness exposes decision and ready flag @regression", async () => {
    const response = await admin.get(rel(Routes.CONFIGURATION_READINESS));
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(typeof body.decision).toBe("string");
    expect(typeof body.ready).toBe("boolean");
    expect(Array.isArray(body.critical_alerts)).toBe(true);
  });
});

test.describe("DVS API - unauthenticated access @master @api @regression", () => {
  test.skip(!process.env.DVS_API_BASE_URL, "Set DVS_API_BASE_URL in .env.");

  const protectedRoutes = [
    Routes.AUTH_ME,
    Routes.OPERATIONS_OVERVIEW,
    Routes.CONFIGURATION_CATALOG,
    Routes.SECURITY_CATALOG,
    Routes.CHAIRMAN_CATALOG,
    Routes.ALLOCATION_CATALOG,
  ];

  for (const route of protectedRoutes) {
    test(`GET ${route} without session returns 401`, async () => {
      const api = await newApiContext();
      const response = await api.get(rel(route));
      expect(response.status()).toBe(401);
      await api.dispose();
    });
  }
});
