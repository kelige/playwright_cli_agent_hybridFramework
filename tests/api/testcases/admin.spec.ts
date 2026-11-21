import "dotenv/config";
import { expect, test } from "@playwright/test";
import { RouteBuilders, Routes } from "../../../api/endpoints/routes";
import { ApiSession, okJson, type Json } from "../../../utils/apiClient";
import { runCase } from "../../../utils/caseRunner";
import { roleCredentials } from "../../../utils/roleSignIn";

/**
 * University Admin API cases — docs/testcases/02-admin.csv.
 * Only read-only and validation-refusal cases run here. Mutating policy,
 * paper and membership writes stay in the live workflow suites.
 */

const admin = roleCredentials("admin");
const tenant = (process.env.WEB_APP_URL ?? "").replace(/\/+$/, "");
const runId = Date.now().toString(36).toLowerCase();

test.describe("University Admin API test cases", () => {
  test.skip(!tenant, "Set WEB_APP_URL to a provisioned tenant.");
  test.skip(!admin.email || !admin.password, "The provisioned Admin credentials are missing.");

  async function session(): Promise<ApiSession> {
    const created = await ApiSession.login(admin.email, admin.password);
    expect(created.loginResponse.status(), "admin login").toBe(200);
    return created;
  }

  test("ADM-008 wrong password is refused @admin @testcase @api", async () => {
    await runCase(
      "ADM-008",
      {
        title: "A wrong password is not refused",
        expected: "401/422 refusal and no authenticated surface",
      },
      async () => {
        const bad = await ApiSession.login(admin.email, `${admin.password}-wrong`);
        try {
          expect([401, 422]).toContain(bad.loginResponse.status());
          const me = await bad.get(Routes.AUTH_ME);
          expect([401, 403]).toContain(me.status());
        } finally {
          await bad.dispose();
        }
      },
    );
  });

  test("ADM-026 duplicate regulation code is rejected @admin @testcase @api", async () => {
    const api = await session();
    try {
      await runCase(
        "ADM-026",
        {
          title: "A duplicate regulation code is accepted",
          expected: "4xx and no second regulation row",
        },
        async () => {
          const catalog = await okJson<Json>(await api.get(Routes.CONFIGURATION_CATALOG), "catalog");
          const regulation = ((catalog.regulations ?? []) as Json[])[0];
          if (!regulation) throw new Error("No regulation exists to duplicate.");
          const programmeIds =
            (regulation.programme_ids as string[] | undefined) ??
            ((catalog.programmes ?? []) as Json[]).slice(0, 1).map((row) => row.id);
          const response = await api.post(Routes.CONFIGURATION_REGULATIONS, {
            code: regulation.code,
            title: `${regulation.title ?? "duplicate"} ${runId}`,
            programme_ids: programmeIds,
          });
          expect([400, 409, 422]).toContain(response.status());
        },
      );
    } finally {
      await api.dispose();
    }
  });

  test("ADM-046 paper question content reports both documents and 24 questions @admin @testcase @api", async () => {
    const api = await session();
    try {
      await runCase(
        "ADM-046",
        {
          title: "Question content readiness is incomplete",
          expected: "paper and scheme ready with 24 total questions",
        },
        async () => {
          const catalog = await okJson<Json>(await api.get(Routes.CONFIGURATION_CATALOG), "catalog");
          const paper = ((catalog.papers ?? []) as Json[])[0];
          if (!paper) throw new Error("No paper exists for the readiness case.");
          const content = await okJson<Json>(
            await api.get(RouteBuilders.configurationPaperQuestionContent(String(paper.id))),
            "question content",
          );
          expect(content.readiness?.question_paper).toBe(true);
          expect(content.readiness?.evaluation_scheme).toBe(true);
          const total =
            Number(content.total_questions ?? (content.questions as Json[] | undefined)?.length ?? 0);
          expect(total).toBe(24);
        },
      );
    } finally {
      await api.dispose();
    }
  });

  test("ADM-057 scheme without a paper is rejected @admin @testcase @api", async () => {
    const api = await session();
    try {
      await runCase(
        "ADM-057",
        {
          title: "A scheme without a paper is accepted",
          expected: "4xx and no scheme created",
        },
        async () => {
          const response = await api.post(Routes.RUBRICS_SCHEMES, {
            title: `Scheme without paper ${runId}`,
            evaluation_guidelines: "none",
            examiner_instructions: "none",
          });
          expect([400, 422]).toContain(response.status());
        },
      );
    } finally {
      await api.dispose();
    }
  });

  test("ADM-075 security catalog reports member role, centre and modules @admin @testcase @api", async () => {
    const api = await session();
    try {
      await runCase(
        "ADM-075",
        {
          title: "Security catalog member scope is incomplete",
          expected: "members carry role, centre and module scope",
        },
        async () => {
          const catalog = await okJson<Json>(await api.get(Routes.SECURITY_CATALOG), "security catalog");
          const members = (catalog.members ?? []) as Json[];
          expect(members.length).toBeGreaterThan(0);
          for (const member of members) {
            expect(String(member.role ?? "")).not.toBe("");
            expect(member).toHaveProperty("operational_centre_id");
            expect(Array.isArray(member.enabled_modules ?? member.modules)).toBe(true);
          }
        },
      );
    } finally {
      await api.dispose();
    }
  });

  test("ADM-108 security context records sessions and history @admin @testcase @api", async () => {
    const api = await session();
    try {
      await runCase(
        "ADM-108",
        {
          title: "Security context does not report sessions and history",
          expected: "200 with session and history evidence for the actor",
        },
        async () => {
          const response = await api.get(Routes.AUTH_SECURITY_CONTEXT);
          expect(response.status()).toBe(200);
          const body = (await response.json()) as Json;
          const sessions = body.sessions ?? body.session_history ?? body.active_sessions;
          const history = body.history ?? body.events ?? body.security_events;
          expect(Array.isArray(sessions), "sessions").toBe(true);
          expect(Array.isArray(history), "history").toBe(true);
        },
      );
    } finally {
      await api.dispose();
    }
  });
});
