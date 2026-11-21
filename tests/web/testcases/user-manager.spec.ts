import "dotenv/config";
import { expect, test } from "@playwright/test";
import { ApiSession, completeFirstLogin, okJson, type Json } from "../../../utils/apiClient";
import { Routes } from "../../../api/endpoints/routes";
import { check } from "../../../utils/defectLog";
import { roleCredentials, signInRole } from "../../../utils/roleSignIn";

/**
 * User Manager test cases — docs/testcases/07-user-manager.csv.
 * Signs in with the User Manager's own account; defects are recorded, not thrown.
 */

const userManager = roleCredentials("user_manager");
const tenant = (process.env.WEB_APP_URL ?? "").replace(/\/+$/, "");
const writes = process.env.DVS_ALLOW_WRITES === "true";
const runId = Date.now().toString(36).toLowerCase();

test.describe("User Manager test cases", () => {
  test.skip(!tenant, "Run `npm run test:platform` so the workflow provisions a university.");
  test.skip(
    !userManager.email || !userManager.password,
    "No User Manager account yet; run `npm run test:platform`.",
  );

  test.use({ storageState: { cookies: [], origins: [] } });

  test("USM-01/02 workspace and module scope @user-manager @testcase", async ({ page }) => {
    const state = await signInRole(page, "user_manager");
    expect(state, "User Manager post-login state").toBe("shell");

    await check(
      "USM-02",
      {
        role: "user-manager",
        area: "workspace",
        severity: "S1",
        title: "The User Manager sidebar is wrong",
        expected: "User management present; no admin or evaluator modules",
      },
      async () => {
        const nav = page.getByRole("navigation", { name: "Primary navigation" });
        await expect(nav.getByRole("button", { name: "User management", exact: true })).toBeVisible();
        for (const foreign of ["Access governance", "Exam configuration", "Evaluation desk"]) {
          await expect(nav.getByRole("button", { name: foreign, exact: true })).toHaveCount(0);
        }
      },
    );
  });

  test("USM-03/04/05 identity and authorization @user-manager @testcase", async () => {
    await check(
      "USM-03",
      {
        role: "user-manager",
        area: "identity",
        severity: "S2",
        title: "The User Manager role is not reported",
        expected: "role = user_manager",
      },
      async () => {
        const session = await ApiSession.login(userManager.email, userManager.password);
        try {
          const me = await okJson(await session.get(Routes.AUTH_ME), "auth/me");
          expect(me.role).toBe("user_manager");
        } finally {
          await session.dispose();
        }
      },
    );

    await check(
      "USM-04",
      {
        role: "user-manager",
        area: "authorization",
        severity: "S1",
        title: "The security catalog is readable without a session",
        expected: "401",
      },
      async () => {
        const { request } = await import("@playwright/test");
        const api = await request.newContext({ baseURL: `${tenant}/`, ignoreHTTPSErrors: true });
        try {
          const response = await api.get(Routes.SECURITY_CATALOG.replace(/^\//, ""));
          expect([401, 403]).toContain(response.status());
        } finally {
          await api.dispose();
        }
      },
    );

    await check(
      "USM-05",
      {
        role: "user-manager",
        area: "authorization",
        severity: "S1",
        title: "The User Manager can read admin configuration",
        expected: "refused",
      },
      async () => {
        const session = await ApiSession.login(userManager.email, userManager.password);
        try {
          const response = await session.get(Routes.CONFIGURATION_CATALOG);
          expect([401, 403]).toContain(response.status());
        } finally {
          await session.dispose();
        }
      },
    );
  });

  test("USM-10..19 provision a Scanner Operator @user-manager @testcase", async () => {
    test.skip(!writes, "Set DVS_ALLOW_WRITES=true to create users.");

    const session = await ApiSession.login(userManager.email, userManager.password);
    try {
      const catalog = await okJson(await session.get(Routes.SECURITY_CATALOG), "security catalog");
      const centre = ((catalog.centres ?? []) as Json[])[0];

      await check(
        "USM-10/11/12/13/14",
        {
          role: "user-manager",
          area: "provisioning",
          severity: "S1",
          title: "The Scanner Operator cannot be provisioned or signed in",
          expected: "handover created, modules match, first login works, temp password single-use",
        },
        async () => {
          if (!centre) throw new Error("No centre exists for this tenant.");
          const email = `dvs.scanner.tc.${runId}@example.com`;
          expect((await session.stepUp(userManager.password)).status()).toBe(200);

          const handover = await okJson(
            await session.post(Routes.SECURITY_MEMBERSHIPS, {
              first_name: "first",
              last_name: "scanner",
              email,
              role: "scanner_operator",
              permissions: [],
              enabled_modules: ["digitization"],
              operational_centre_id: centre.id,
              programme_id: null,
              custom_fields: {},
            }),
            "create scanner",
          );
          expect(handover.role).toBe("scanner_operator");
          expect(handover.enabled_modules).toEqual(["digitization"]);
          expect(handover.temporary_password).toBeTruthy();

          const scanner = await completeFirstLogin(
            email,
            handover.temporary_password,
            process.env.DVS_ROLE_NEW_PASSWORD ?? "",
          );
          try {
            const me = await okJson(await scanner.get(Routes.AUTH_ME), "scanner me");
            expect(me.role).toBe("scanner_operator");

            const reuse = await ApiSession.login(email, handover.temporary_password);
            try {
              expect(reuse.loginResponse.status()).toBe(401);
            } finally {
              await reuse.dispose();
            }
          } finally {
            await scanner.dispose();
          }

          const refreshed = await okJson(
            await session.get(Routes.SECURITY_CATALOG),
            "security catalog refresh",
          );
          expect(refreshed.members.some((member: Json) => member.email === email)).toBe(true);
        },
      );

      await check(
        "USM-15/16/17/18/19",
        {
          role: "user-manager",
          area: "validation",
          severity: "S2",
          title: "User validation is missing",
          expected: "no centre, duplicate email, missing names and malformed email all rejected",
        },
        async () => {
          expect((await session.stepUp(userManager.password)).status()).toBe(200);
          const base = {
            first_name: "first",
            last_name: "scanner",
            email: `dvs.scanner.valid.${runId}@example.com`,
            role: "scanner_operator",
            permissions: [],
            enabled_modules: ["digitization"],
            operational_centre_id: centre?.id ?? null,
            programme_id: null,
            custom_fields: {},
          };
          const cases: Json[] = [
            { ...base, operational_centre_id: null },
            { ...base, email: `dvs.scanner.tc.${runId}@example.com` },
            { ...base, email: `dvs.nofirst.${runId}@example.com`, first_name: "" },
            { ...base, email: `dvs.nolast.${runId}@example.com`, last_name: "" },
            { ...base, email: "not-an-email" },
          ];
          for (const payload of cases) {
            const response = await session.post(Routes.SECURITY_MEMBERSHIPS, payload);
            expect(response.status()).toBeGreaterThanOrEqual(400);
            expect(response.status()).toBeLessThan(500);
          }
        },
      );
    } finally {
      await session.dispose();
    }
  });

  test("USM-20..24 authorization boundaries @user-manager @testcase", async () => {
    const session = await ApiSession.login(userManager.email, userManager.password);
    try {
      await check(
        "USM-20",
        {
          role: "user-manager",
          area: "authorization",
          severity: "S1",
          title: "A membership can be created without step-up",
          expected: "401/403",
        },
        async () => {
          const response = await session.post(Routes.SECURITY_MEMBERSHIPS, {
            first_name: "no",
            last_name: "stepup",
            email: `dvs.nostep.um.${runId}@example.com`,
            role: "scanner_operator",
            permissions: [],
            enabled_modules: ["digitization"],
            operational_centre_id: null,
            programme_id: null,
            custom_fields: {},
          });
          expect([401, 403, 428]).toContain(response.status());
        },
      );

      await check(
        "USM-21/22",
        {
          role: "user-manager",
          area: "authorization",
          severity: "S1",
          title: "The User Manager can escalate to an admin or create a Chairman",
          expected: "both refused",
        },
        async () => {
          expect((await session.stepUp(userManager.password)).status()).toBe(200);
          for (const role of ["university_admin", "chairman"]) {
            const response = await session.post(Routes.SECURITY_MEMBERSHIPS, {
              first_name: "escalate",
              last_name: role,
              email: `dvs.escalate.${role}.${runId}@example.com`,
              role,
              permissions: [],
              enabled_modules: [],
              operational_centre_id: null,
              programme_id: null,
              custom_fields: {},
            });
            expect([400, 401, 403, 422], `create ${role}`).toContain(response.status());
          }
        },
      );

      await check(
        "USM-24",
        {
          role: "user-manager",
          area: "authorization",
          severity: "S1",
          title: "The User Manager can save the security policy",
          expected: "refused",
        },
        async () => {
          const catalog = await session.get(Routes.SECURITY_CATALOG);
          if (catalog.status() !== 200) throw new Error("Security catalog is not readable.");
          const body = (await catalog.json()) as Json;
          const response = await session.put(Routes.SECURITY_POLICY, body.policy ?? {});
          expect([401, 403, 428]).toContain(response.status());
        },
      );
    } finally {
      await session.dispose();
    }
  });
});
