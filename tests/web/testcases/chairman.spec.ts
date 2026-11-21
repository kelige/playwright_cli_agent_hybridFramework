import "dotenv/config";
import { expect, test } from "@playwright/test";
import { ApiSession, okJson, type Json } from "../../../utils/apiClient";
import { RouteBuilders, Routes } from "../../../api/endpoints/routes";
import { check } from "../../../utils/defectLog";
import { roleCredentials, signInRole } from "../../../utils/roleSignIn";

/**
 * Chairman test cases — docs/testcases/03-chairman.csv.
 * Signs in with the Chairman's own account; defects are recorded, not thrown.
 */

const chairman = roleCredentials("chairman");
const tenant = (process.env.WEB_APP_URL ?? "").replace(/\/+$/, "");
const writes = process.env.DVS_ALLOW_WRITES === "true";
const runId = Date.now().toString(36).toLowerCase();

test.describe("Chairman test cases", () => {
  test.skip(!tenant, "Run `npm run test:platform` so the workflow provisions a university.");
  test.skip(
    !chairman.email || !chairman.password,
    "No Chairman account yet. Run `npm run test:platform` so the workflow provisions one.",
  );

  test.use({ storageState: { cookies: [], origins: [] } });

  test("CHM-01/02/03 UI workspace and module scope @chairman @testcase", async ({ page }) => {
    const state = await signInRole(page, "chairman");
    expect(state, "Chairman post-login state").toBe("shell");

    await check(
      "CHM-02",
      {
        role: "chairman",
        area: "workspace",
        severity: "S1",
        title: "The Chairman workspace is missing its modules",
        expected: "Chief nominations and Chief master are in the sidebar",
      },
      async () => {
        const nav = page.getByRole("navigation", { name: "Primary navigation" });
        await expect(nav.getByRole("button", { name: "Chief nominations", exact: true })).toBeVisible();
        await expect(nav.getByRole("button", { name: "Chief master", exact: true })).toBeVisible();
      },
    );

    await check(
      "CHM-03",
      {
        role: "chairman",
        area: "authorization",
        severity: "S1",
        title: "The Chairman sidebar exposes another role's modules",
        expected: "no Access governance, Evaluation desk or Digitization",
      },
      async () => {
        const nav = page.getByRole("navigation", { name: "Primary navigation" });
        for (const foreign of ["Access governance", "Evaluation desk", "Digitization"]) {
          await expect(nav.getByRole("button", { name: foreign, exact: true })).toHaveCount(0);
        }
      },
    );
  });

  test("CHM-04/05/07 API identity and scope @chairman @testcase", async () => {
    await check(
      "CHM-04/05",
      {
        role: "chairman",
        area: "identity",
        severity: "S2",
        title: "The Chairman identity or subject scope is wrong",
        expected: "role chairman and a scoped subject list",
      },
      async () => {
        const session = await ApiSession.login(chairman.email, chairman.password);
        try {
          const me = await okJson(await session.get(Routes.AUTH_ME), "auth/me");
          expect(me.role).toBe("chairman");

          const catalog = await okJson(
            await session.get(Routes.CHAIRMAN_CATALOG),
            "chairman catalog",
          );
          expect(Array.isArray(catalog.subjects)).toBe(true);
        } finally {
          await session.dispose();
        }
      },
    );

    await check(
      "CHM-07",
      {
        role: "chairman",
        area: "authorization",
        severity: "S1",
        title: "The Chairman catalog is readable without a session",
        expected: "401/403",
      },
      async () => {
        const { request } = await import("@playwright/test");
        const api = await request.newContext({ baseURL: `${tenant}/`, ignoreHTTPSErrors: true });
        try {
          const response = await api.get(Routes.CHAIRMAN_CATALOG.replace(/^\//, ""));
          expect([401, 403]).toContain(response.status());
        } finally {
          await api.dispose();
        }
      },
    );

    await check(
      "CHM-08",
      {
        role: "chairman",
        area: "authorization",
        severity: "S1",
        title: "The Chairman can read admin-only governance data",
        expected: "refused",
      },
      async () => {
        const session = await ApiSession.login(chairman.email, chairman.password);
        try {
          const response = await session.get(Routes.SECURITY_CATALOG);
          expect([401, 403], "security catalog as chairman").toContain(response.status());
        } finally {
          await session.dispose();
        }
      },
    );
  });

  test("CHM-10..18 chief master registration @chairman @testcase", async () => {
    test.skip(!writes, "Set DVS_ALLOW_WRITES=true to register a chief.");

    const session = await ApiSession.login(chairman.email, chairman.password);
    try {
      const catalog = await okJson(await session.get(Routes.CHAIRMAN_CATALOG), "chairman catalog");
      const subject = ((catalog.subjects ?? []) as Json[])[0];
      if (!subject) {
        await check(
          "CHM-10",
          {
            role: "chairman",
            area: "chief master",
            severity: "S1",
            title: "No subject is in the Chairman's scope",
            expected: "the workflow's subject is available",
          },
          async () => {
            throw new Error("The Chairman catalog returned no subject.");
          },
        );
        return;
      }

      let chiefId = "";
      await check(
        "CHM-06",
        {
          role: "chairman",
          area: "chief master",
          severity: "S1",
          title: "A non-chief profile can be registered by the Chairman",
          expected: "403",
        },
        async () => {
          const response = await session.post(Routes.EVALUATOR_MANAGEMENT, {
            display_name: "Not a chief",
            email: `dvs.notchief.${runId}@example.com`,
            institution_name: "DVS Institute",
            department: "CSE",
            years_experience: 1,
            employment_type: "permanent",
            subject_ids: [subject.id],
          });
          expect(response.status()).toBe(403);
        },
      );

      await check(
        "CHM-10/11/12/18",
        {
          role: "chairman",
          area: "chief master",
          severity: "S1",
          title: "The chief examiner cannot be registered",
          expected: "chief created without a login and listed",
        },
        async () => {
          const email = `dvs.chief.tc.${runId}@example.com`;
          const profile = await okJson(
            await session.post(Routes.EVALUATOR_MANAGEMENT, {
              display_name: `DVS Chief ${runId}`,
              email,
              institution_name: "DVS Automation Institute",
              department: "CSE",
              years_experience: 10,
              mobile: "",
              employee_id: `DVS-EMP-CHIEF-${runId}`,
              designation: "Assistant Professor",
              qualification: "MTech",
              employment_type: "permanent",
              grade: "chief",
              subject_ids: [subject.id],
            }),
            "register chief",
          );
          chiefId = profile.id;
          expect(profile.role).toBe("chief");
          expect(profile.login_enabled).toBe(false);
        },
      );

      await check(
        "CHM-13/14/15/17",
        {
          role: "chairman",
          area: "chief master",
          severity: "S2",
          title: "Chief registration validation is missing",
          expected: "duplicate email, empty name, missing institution and empty subjects all rejected",
        },
        async () => {
          const base = {
            display_name: `DVS Chief ${runId}`,
            email: `dvs.chief.tc.${runId}@example.com`,
            institution_name: "DVS Automation Institute",
            department: "CSE",
            years_experience: 10,
            employment_type: "permanent",
            subject_ids: [subject.id],
          };
          const cases: Json[] = [
            { ...base },
            { ...base, email: `dvs.chief.noname.${runId}@example.com`, display_name: "" },
            { ...base, email: `dvs.chief.noinst.${runId}@example.com`, institution_name: "" },
            { ...base, email: `dvs.chief.nosub.${runId}@example.com`, subject_ids: [] },
          ];
          for (const payload of cases) {
            const response = await session.post(Routes.EVALUATOR_MANAGEMENT, payload);
            expect(response.status(), `payload ${JSON.stringify(payload).slice(0, 80)}`).toBeGreaterThanOrEqual(400);
            expect(response.status()).toBeLessThan(500);
          }
        },
      );

      await check(
        "CHM-20/21/22/23",
        {
          role: "chairman",
          area: "nominations",
          severity: "S1",
          title: "The chief cannot be nominated or the handover is missing",
          expected: "pending nomination with a temporary password; visible to the Chief",
        },
        async () => {
          const nomination = await okJson(
            await session.post(Routes.CHAIRMAN_NOMINATIONS, {
              subject_id: subject.id,
              evaluator_id: chiefId,
            }),
            "nominate chief",
          );
          expect(nomination.status).toBe("pending");
          expect(nomination.credentials?.temporary_password).toBeTruthy();
        },
      );

      await check(
        "CHM-25/26",
        {
          role: "chairman",
          area: "nominations",
          severity: "S1",
          title: "Nominations accept an unknown evaluator or a foreign subject",
          expected: "both refused",
        },
        async () => {
          const unknown = await session.post(Routes.CHAIRMAN_NOMINATIONS, {
            subject_id: subject.id,
            evaluator_id: "00000000-0000-0000-0000-000000000000",
          });
          expect(unknown.status()).toBeGreaterThanOrEqual(400);

          const foreign = await session.post(Routes.CHAIRMAN_NOMINATIONS, {
            subject_id: "00000000-0000-0000-0000-000000000000",
            evaluator_id: chiefId,
          });
          expect(foreign.status()).toBeGreaterThanOrEqual(400);
        },
      );
    } finally {
      await session.dispose();
    }
  });
});
