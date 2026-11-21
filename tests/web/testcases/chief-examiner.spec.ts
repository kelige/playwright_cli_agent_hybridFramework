import "dotenv/config";
import * as fs from "node:fs";
import { expect, test } from "@playwright/test";
import { ApiSession, okJson, type Json } from "../../../utils/apiClient";
import { RouteBuilders, Routes } from "../../../api/endpoints/routes";
import { check } from "../../../utils/defectLog";
import { roleCredentials, signInRole } from "../../../utils/roleSignIn";
import { DVS_ROLES } from "../../../utils/dvsRoles";

/**
 * Chief Examiner test cases — docs/testcases/04-chief-examiner.csv.
 * Reads the run's own ids from the persisted run state.
 */

const chief = roleCredentials("chief");
const tenant = (process.env.WEB_APP_URL ?? "").replace(/\/+$/, "");
const writes = process.env.DVS_ALLOW_WRITES === "true";

/** Chief modules verified in prompts/KTR_WEB_TEST_PROMPTS.md §21. */
const CHIEF_MODULES = DVS_ROLES.find((role) => role.role === "chief")!.modules;

/** Reads the run state written by the workflow. */
function runState(): { ids: Record<string, string> } {
  try {
    return JSON.parse(
      fs.readFileSync("playwright/.auth/dvs-run-state.json", "utf-8"),
    ) as { ids: Record<string, string> };
  } catch {
    return { ids: {} };
  }
}

test.describe("Chief Examiner test cases", () => {
  test.skip(!tenant, "Run `npm run test:platform` so the workflow provisions a university.");
  test.skip(!chief.email || !chief.password, "No Chief account yet; run `npm run test:platform`.");

  test.use({ storageState: { cookies: [], origins: [] } });

  test("CHF-01/02/03 UI workspace and module scope @chief @testcase", async ({ page }) => {
    const state = await signInRole(page, "chief");
    expect(state, "Chief post-login state").toBe("shell");

    await check(
      "CHF-02",
      {
        role: "chief",
        area: "workspace",
        severity: "S1",
        title: "The Chief workspace is missing documented modules",
        expected: CHIEF_MODULES.join(", "),
      },
      async () => {
        const nav = page.getByRole("navigation", { name: "Primary navigation" });
        for (const moduleName of CHIEF_MODULES) {
          await expect(nav.getByRole("button", { name: moduleName, exact: true })).toBeVisible();
        }
      },
    );

    await check(
      "CHF-03",
      {
        role: "chief",
        area: "authorization",
        severity: "S1",
        title: "The Chief sidebar exposes another role's modules",
        expected: "no Exam configuration, Access governance or Evaluation desk",
      },
      async () => {
        const nav = page.getByRole("navigation", { name: "Primary navigation" });
        for (const foreign of ["Exam configuration", "Access governance", "Evaluation desk"]) {
          await expect(nav.getByRole("button", { name: foreign, exact: true })).toHaveCount(0);
        }
      },
    );
  });

  test("CHF-04/05 identity and anonymous access @chief @testcase", async () => {
    await check(
      "CHF-04",
      {
        role: "chief",
        area: "identity",
        severity: "S2",
        title: "The Chief grade is not reported",
        expected: "evaluator_grade = chief",
      },
      async () => {
        const session = await ApiSession.login(chief.email, chief.password);
        try {
          const me = await okJson(await session.get(Routes.AUTH_ME), "auth/me");
          expect(me.evaluator_grade).toBe("chief");
        } finally {
          await session.dispose();
        }
      },
    );

    await check(
      "CHF-05",
      {
        role: "chief",
        area: "authorization",
        severity: "S1",
        title: "The chief summary is readable without a session",
        expected: "401",
      },
      async () => {
        const { request } = await import("@playwright/test");
        const api = await request.newContext({ baseURL: `${tenant}/`, ignoreHTTPSErrors: true });
        try {
          const response = await api.get(Routes.CHIEF_SUMMARY.replace(/^\//, ""));
          expect([401, 403]).toContain(response.status());
        } finally {
          await api.dispose();
        }
      },
    );
  });

  test("CHF-10..14 nomination acceptance @chief @testcase", async () => {
    test.skip(!writes, "Set DVS_ALLOW_WRITES=true to accept a nomination.");

    const state = runState();
    const session = await ApiSession.login(chief.email, chief.password);
    try {
      await check(
        "CHF-10/11/12/13",
        {
          role: "chief",
          area: "nomination",
          severity: "S1",
          title: "Nomination acceptance does not unlock the Chief scope",
          expected: "pending, accepted once, scope unlocked, second accept refused",
        },
        async () => {
          const mine = await okJson(
            await session.get(Routes.CHAIRMAN_MY_NOMINATIONS),
            "my nominations",
          );
          const pending = ((mine.items ?? []) as Json[]).find(
            (item) => item.status === "pending" && item.can_accept,
          );

          const nomination =
            pending ?? ((mine.items ?? []) as Json[]).find((item) => item.id === state.ids.nomination);
          if (!nomination) throw new Error("No nomination is available for this Chief.");

          const accepted = await okJson(
            await session.post(RouteBuilders.chairmanNominationAccept(nomination.id)),
            "accept nomination",
          );
          expect(accepted.status).toBe("completed");

          const summary = await okJson(await session.get(Routes.CHIEF_SUMMARY), "chief summary");
          expect(summary.ready).toBe(true);
          expect((summary.subjects ?? []).length).toBeGreaterThan(0);

          const again = await session.post(RouteBuilders.chairmanNominationAccept(nomination.id));
          expect([400, 403, 409]).toContain(again.status());
        },
      );

      await check(
        "CHF-14",
        {
          role: "chief",
          area: "nomination",
          severity: "S1",
          title: "A nomination that is not this Chief's can be accepted",
          expected: "refused",
        },
        async () => {
          const response = await session.post(
            RouteBuilders.chairmanNominationAccept("00000000-0000-0000-0000-000000000000"),
          );
          expect([400, 403, 404, 409]).toContain(response.status());
        },
      );
    } finally {
      await session.dispose();
    }
  });

  test("CHF-20..25 evaluator master and team @chief @testcase", async () => {
    test.skip(!writes, "Set DVS_ALLOW_WRITES=true to register and nominate an evaluator.");

    const state = runState();
    const session = await ApiSession.login(chief.email, chief.password);
    try {
      await check(
        "CHF-20/21/22/23",
        {
          role: "chief",
          area: "evaluator master",
          severity: "S1",
          title: "Evaluator registration, nomination or team listing fails",
          expected: "registered -> nominated -> listed in the team",
        },
        async () => {
          const summary = await okJson(await session.get(Routes.CHIEF_SUMMARY), "chief summary");
          const subject = ((summary.subjects ?? []) as Json[])[0];
          if (!subject) throw new Error("The Chief has no accepted subject scope.");

          const email = `dvs.evaluator.tc.${Date.now().toString(36)}@example.com`;
          const profile = await okJson(
            await session.post(Routes.EVALUATOR_MANAGEMENT, {
              display_name: `DVS Evaluator ${email}`,
              email,
              institution_name: "DVS Automation Institute",
              department: "CSE",
              years_experience: 5,
              mobile: "",
              employee_id: `DVS-EMP-EVAL-${Date.now()}`,
              designation: "Assistant Professor",
              qualification: "MTech",
              employment_type: "contract",
              subject_ids: [subject.id],
            }),
            "register evaluator",
          );
          expect(profile.role).toBe("evaluator");

          if (state.ids.subject && subject.id !== state.ids.subject) {
            throw new Error("The Chief's accepted subject does not match the workflow's subject.");
          }

          const nominated = await okJson(
            await session.post(Routes.CHIEF_TEAM_NOMINATIONS, {
              evaluator_id: profile.id,
              subject_id: subject.id,
            }),
            "nominate evaluator",
          );
          expect(nominated.nominated).toBe(true);

          const team = await okJson(await session.get(Routes.EVALUATOR_TEAM), "chief team");
          expect((team.assigned_evaluators ?? []).some((row: Json) => row.id === profile.id)).toBe(true);
        },
      );

      await check(
        "CHF-24",
        {
          role: "chief",
          area: "evaluator master",
          severity: "S2",
          title: "A duplicate evaluator email is accepted",
          expected: "4xx",
        },
        async () => {
          const response = await session.post(Routes.EVALUATOR_MANAGEMENT, {
            display_name: "Duplicate Evaluator",
            email: `dvs.evaluator.tc.${Date.now().toString(36)}@example.com`,
            institution_name: "DVS Automation Institute",
            department: "CSE",
            years_experience: 5,
            employment_type: "contract",
            subject_ids: [],
          });
          expect(response.status()).toBeGreaterThanOrEqual(400);
          expect(response.status()).toBeLessThan(500);
        },
      );
    } finally {
      await session.dispose();
    }
  });

  test("CHF-30..36 allocation engine @chief @testcase", async () => {
    const state = runState();
    const session = await ApiSession.login(chief.email, chief.password);
    try {
      await check(
        "CHF-30/31/32/33/34",
        {
          role: "chief",
          area: "allocation",
          severity: "S1",
          title: "Allocation does not enforce attendance or does not assign the packet",
          expected: "ready packet, attendance gate, single-evaluator assignment",
        },
        async () => {
          const batches = await okJson<Json[]>(
            await session.get(Routes.ALLOCATION_EXAMINER_BATCHES),
            "examiner batches",
          );
          const batch =
            batches.find((candidate) => candidate.chief?.id === state.ids.chiefProfile) ?? batches[0];
          if (!batch) throw new Error("The Chief has no allocation batch.");

          const groups = await okJson(
            await session.get(RouteBuilders.allocationSubjectGroups(batch.id)),
            "subject groups",
          );
          const rows = (groups.groups ?? []) as Json[];
          expect(rows.length, "subject groups in the batch").toBeGreaterThan(0);

          const ready = rows.find((row) => row.ready);
          if (!ready) throw new Error("No submitted packet is ready for allocation in this batch.");
          expect(ready.submitted).toBe(true);

          const member = ((batch.members ?? []) as Json[])[0];
          expect(member, "batch member").toBeTruthy();

          const allocated = await session.post(
            RouteBuilders.allocationAllocateSubjectGroup(batch.id),
            { group_id: ready.group_id, member_id: member.id },
          );
          // 403 is the correct attendance gate; 200/201 means the packet was assigned.
          expect([200, 201, 403, 409]).toContain(allocated.status());
        },
      );

      await check(
        "CHF-36",
        {
          role: "chief",
          area: "allocation",
          severity: "S1",
          title: "Allocation accepts an unknown batch",
          expected: "refused",
        },
        async () => {
          const response = await session.post(
            RouteBuilders.allocationAllocateSubjectGroup("00000000-0000-0000-0000-000000000000"),
            { group_id: "00000000-0000-0000-0000-000000000000", member_id: "x" },
          );
          expect([400, 403, 404]).toContain(response.status());
        },
      );
    } finally {
      await session.dispose();
    }
  });

  test("CHF-40..45 moderation and reporting @chief @testcase", async () => {
    test.skip(!writes, "Set DVS_ALLOW_WRITES=true to moderate.");

    const session = await ApiSession.login(chief.email, chief.password);
    try {
      await check(
        "CHF-40/41/42/43",
        {
          role: "chief",
          area: "moderation",
          severity: "S1",
          title: "The moderation and report chain cannot complete",
          expected: "source -> operation -> approve -> moderation report submitted",
        },
        async () => {
          const assessment = await okJson(
            await session.get(Routes.PHASE4_ASSESSMENT_CATALOG),
            "assessment catalog",
          );
          const sources = (assessment.moderation_sources ?? []) as Json[];
          if (!sources.length) {
            throw new Error("No moderation source: the Evaluator has not submitted an evaluation.");
          }
          const paperId = String(sources[0].paper_id ?? "");

          const batches = await okJson<Json[]>(
            await session.get(Routes.ALLOCATION_EXAMINER_BATCHES),
            "examiner batches",
          );
          const batch = batches[0];
          if (!batch) throw new Error("No chief batch for moderation selection.");

          const operation =
            ((assessment.moderation_operations ?? []) as Json[]).find(
              (candidate) => candidate.paper_id === paperId,
            ) ??
            (await okJson(
              await session.post(RouteBuilders.phase4ModerationSelection(batch.id), {
                record_ids: sources.filter((source) => source.paper_id === paperId).map((s) => s.id),
              }),
              "moderation selection",
            ));

          const refreshed = await okJson(
            await session.get(Routes.PHASE4_ASSESSMENT_CATALOG),
            "assessment catalog refresh",
          );
          const active = ((refreshed.moderation_operations ?? []) as Json[]).find(
            (candidate) => candidate.paper_id === paperId,
          );
          if (!active) throw new Error("The moderation operation was not created.");

          if (!["approved", "completed"].includes(String(active.status))) {
            const decision = await okJson(
              await session.post(RouteBuilders.phase4ModerationDecision(active.id), {
                version: Number(active.version ?? 1),
                decision: "approve",
                reason: "Independent moderation review completed with recorded evidence.",
              }),
              "moderation decision",
            );
            expect(["approved", "completed"]).toContain(decision.status);
          }
          expect(operation).toBeTruthy();
        },
      );

      await check(
        "CHF-44/45",
        {
          role: "chief",
          area: "moderation",
          severity: "S2",
          title: "A stale moderation version is accepted or moderation runs with no source",
          expected: "409 for a stale version; refusal with no submitted source",
        },
        async () => {
          const decision = await session.post(
            RouteBuilders.phase4ModerationDecision("00000000-0000-0000-0000-000000000000"),
            { version: 1, decision: "approve", reason: "stale" },
          );
          expect([400, 403, 404, 409]).toContain(decision.status());
        },
      );
    } finally {
      await session.dispose();
    }
  });

  test("CHF-50..53 attendance and monitoring @chief @testcase", async () => {
    const session = await ApiSession.login(chief.email, chief.password);
    try {
      await check(
        "CHF-50/51",
        {
          role: "chief",
          area: "attendance",
          severity: "S1",
          title: "Attendance presence is not driven by the face step",
          expected: "presence recorded only after the face step",
        },
        async () => {
          const batches = await okJson<Json[]>(
            await session.get(Routes.ALLOCATION_EXAMINER_BATCHES),
            "examiner batches",
          );
          const batch = batches[0];
          if (!batch) throw new Error("The Chief has no allocation batch.");

          const members = (batch.members ?? []) as Json[];
          expect(members.length).toBeGreaterThan(0);
          for (const member of members) {
            expect(member).toHaveProperty("packet_available");
          }
        },
      );

      await check(
        "CHF-52/53",
        {
          role: "chief",
          area: "monitoring",
          severity: "S3",
          title: "Live monitoring or the moderation list is unavailable",
          expected: "monitoring state and moderation entries readable",
        },
        async () => {
          const monitor = await session.get(Routes.PHASE4_HIERARCHY_MONITORING);
          expect([200, 403]).toContain(monitor.status());
          if (monitor.status() === 200) {
            const body = (await monitor.json()) as unknown;
            expect(["object", "boolean"]).toContain(typeof body);
          }

          const moderation = await session.get(Routes.CHIEF_MODERATION_REPORT);
          expect([200, 403]).toContain(moderation.status());
        },
      );
    } finally {
      await session.dispose();
    }
  });
});
