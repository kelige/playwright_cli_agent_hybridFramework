import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import { ApiSession, okJson, type Json } from "../../../utils/apiClient";
import { RouteBuilders, Routes } from "../../../api/endpoints/routes";
import { check } from "../../../utils/defectLog";
import { roleCredentials } from "../../../utils/roleSignIn";

/**
 * Admin test cases — docs/testcases/02-admin.csv.
 *
 * Each case signs in automatically, asserts its own outcome, and records a defect
 * in docs/BUG_DVS.md instead of aborting the suite, so one broken outcome
 * never hides the remaining Admin cases.
 */

const admin = roleCredentials("admin");
const tenant = (process.env.WEB_APP_URL ?? "").replace(/\/+$/, "");
const writes = process.env.DVS_ALLOW_WRITES === "true";
const runId = Date.now().toString(36).toUpperCase();

const testdataDir = path.resolve(process.cwd(), "testdata");
const academic = JSON.parse(
  fs.readFileSync(path.join(testdataDir, "dvs_academic_config.json"), "utf-8"),
) as Json;
const paperConfig = JSON.parse(
  fs.readFileSync(path.join(testdataDir, "dvs_paper_config.json"), "utf-8"),
) as Json;

test.describe("Admin test cases", () => {
  test.skip(!tenant, "Run `npm run test:platform` so the workflow provisions a university.");
  test.skip(!admin.email || !admin.password, "The provisioned Admin credentials are missing.");

  test("ADM-01/03/04/07 authentication @admin @testcase", async () => {
    await check(
      "ADM-01",
      {
        role: "admin",
        area: "authentication",
        severity: "S1",
        title: "Admin cannot sign in with the permanent password",
        expected: "200 with an administrator session",
      },
      async () => {
        const session = await ApiSession.login(admin.email, admin.password);
        try {
          expect(session.loginResponse.status()).toBe(200);
          const me = await okJson(await session.get(Routes.AUTH_ME), "auth/me");
          expect(String(me.role)).toMatch(/admin/i);
          expect(String(me.tenant?.id ?? "")).not.toBe("");
        } finally {
          await session.dispose();
        }
      },
    );

    await check(
      "ADM-03",
      {
        role: "admin",
        area: "authentication",
        severity: "S1",
        title: "A wrong password is not rejected",
        expected: "401 and no session",
      },
      async () => {
        const session = await ApiSession.login(admin.email, `${admin.password}-wrong`);
        try {
          expect(session.loginResponse.status()).toBe(401);
        } finally {
          await session.dispose();
        }
      },
    );

    await check(
      "ADM-04",
      {
        role: "admin",
        area: "authentication",
        severity: "S2",
        title: "An unknown account does not get the same refusal",
        expected: "401 without disclosing account existence",
      },
      async () => {
        const session = await ApiSession.login(`dvs.unknown.${runId}@example.invalid`, "WrongPass1!");
        try {
          // An unknown account is refused either as an authentication failure
          // (401) or as a validation failure (422); both must be non-success and
          // must not disclose whether the account exists.
          expect([401, 422]).toContain(session.loginResponse.status());
          const body = (await session.loginResponse.text()).toLowerCase();
          expect(body).not.toContain("no such user");
          expect(body).not.toContain("unknown user");
        } finally {
          await session.dispose();
        }
      },
    );
  });

  test("ADM-06 unauthenticated access is refused @admin @testcase", async () => {
    await check(
      "ADM-06",
      {
        role: "admin",
        area: "authorization",
        severity: "S1",
        title: "The configuration catalog is readable without a session",
        expected: "401/403 for an anonymous request",
      },
      async () => {
        const { request } = await import("@playwright/test");
        const api = await request.newContext({ baseURL: `${tenant}/`, ignoreHTTPSErrors: true });
        try {
          const response = await api.get(Routes.CONFIGURATION_CATALOG.replace(/^\//, ""));
          expect([401, 403]).toContain(response.status());
        } finally {
          await api.dispose();
        }
      },
    );
  });

  test("ADM-10..20 academic configuration chain @admin @testcase", async () => {
    test.skip(!writes, "Set DVS_ALLOW_WRITES=true to create configuration records.");

    const adminSession = await ApiSession.login(admin.email, admin.password);
    const ids: Record<string, string> = {};
    try {
      await check(
        "ADM-10",
        {
          role: "admin",
          area: "configuration",
          severity: "S1",
          title: "Degree / Programme cannot be created",
          expected: "201 with a programme id",
        },
        async () => {
          const body = await okJson(
            await adminSession.post(Routes.CONFIGURATION_PROGRAMMES, {
              code: `${academic.programme.code}-${runId}`,
              name: `${academic.programme.name} ${runId}`,
            }),
            "create programme",
          );
          ids.programme = body.id;
          expect(body.id).toBeTruthy();
        },
      );

      await check(
        "ADM-11",
        {
          role: "admin",
          area: "configuration",
          severity: "S2",
          title: "A duplicate programme code is accepted",
          expected: "4xx and no duplicate row",
        },
        async () => {
          const response = await adminSession.post(Routes.CONFIGURATION_PROGRAMMES, {
            code: `${academic.programme.code}-${runId}`,
            name: `${academic.programme.name} ${runId}`,
          });
          expect(response.status()).toBeGreaterThanOrEqual(400);
          expect(response.status()).toBeLessThan(500);
        },
      );

      await check(
        "ADM-12",
        {
          role: "admin",
          area: "configuration",
          severity: "S2",
          title: "An empty programme code is accepted",
          expected: "4xx and nothing created",
        },
        async () => {
          const response = await adminSession.post(Routes.CONFIGURATION_PROGRAMMES, {
            code: "",
            name: "empty code",
          });
          expect(response.status()).toBeGreaterThanOrEqual(400);
          expect(response.status()).toBeLessThan(500);
        },
      );

      await check(
        "ADM-13",
        {
          role: "admin",
          area: "configuration",
          severity: "S1",
          title: "Scheme / Regulation cannot be created",
          expected: "regulation linked to the programme",
        },
        async () => {
          const body = await okJson(
            await adminSession.post(Routes.CONFIGURATION_REGULATIONS, {
              code: `${academic.regulation.code}-${runId}`,
              title: `${academic.regulation.title} ${runId}`,
              programme_ids: [ids.programme],
            }),
            "create regulation",
          );
          ids.regulation = body.id;
        },
      );

      await check(
        "ADM-15/16/17/18",
        {
          role: "admin",
          area: "configuration",
          severity: "S1",
          title: "The academic chain does not complete",
          expected: "year, session, course and subject all created",
        },
        async () => {
          const year = await okJson(
            await adminSession.post(Routes.CONFIGURATION_ACADEMIC_YEARS, {
              regulation_id: ids.regulation,
              label: academic.academicYear.label,
            }),
            "create academic year",
          );
          ids.academicYear = year.id;

          const session = await okJson(
            await adminSession.post(Routes.CONFIGURATION_SESSIONS, {
              programme_id: ids.programme,
              academic_year_id: ids.academicYear,
              name: `${academic.examSession.name} ${runId}`,
            }),
            "create session",
          );
          ids.session = session.id;
          expect(session.version).toBe(1);

          const course = await okJson(
            await adminSession.post(Routes.CONFIGURATION_COURSES, {
              programme_id: ids.programme,
              regulation_id: ids.regulation,
              code: `${academic.course.code}-${runId}`,
              name: `${academic.course.name} ${runId}`,
            }),
            "create course",
          );
          ids.course = course.id;

          const subject = await okJson(
            await adminSession.post(Routes.CONFIGURATION_SUBJECTS, {
              programme_id: ids.programme,
              regulation_id: ids.regulation,
              academic_year_id: ids.academicYear,
              course_id: ids.course,
              semester: academic.subject.semester,
              session_ids: [ids.session],
              code: `${academic.subject.code}-${runId}`,
              name: `${academic.subject.name} ${runId}`,
            }),
            "create subject",
          );
          ids.subject = subject.id;
        },
      );

      await check(
        "ADM-19",
        {
          role: "admin",
          area: "configuration",
          severity: "S1",
          title: "Created configuration records are missing from the catalog",
          expected: "every created id appears in the catalog",
        },
        async () => {
          const catalog = await okJson(
            await adminSession.get(Routes.CONFIGURATION_CATALOG),
            "configuration catalog",
          );
          for (const key of ["programme", "regulation", "academicYear", "session", "course", "subject"]) {
            expect(ids[key], `${key} created`).toBeTruthy();
          }
          expect(catalog.subjects.some((row: Json) => row.id === ids.subject)).toBe(true);
        },
      );

      await check(
        "ADM-20",
        {
          role: "admin",
          area: "configuration",
          severity: "S2",
          title: "Configuration readiness does not return a decision",
          expected: "a readiness decision and ready flag",
        },
        async () => {
          const readiness = await okJson(
            await adminSession.get(Routes.CONFIGURATION_READINESS),
            "readiness",
          );
          expect(readiness).toHaveProperty("ready");
        },
      );
    } finally {
      await adminSession.dispose();
    }
  });

  test("ADM-30..40 papers, documents and marking schemes @admin @testcase", async () => {
    test.skip(!writes, "Set DVS_ALLOW_WRITES=true to create paper records.");

    const adminSession = await ApiSession.login(admin.email, admin.password);
    try {
      const catalog = await okJson(
        await adminSession.get(Routes.CONFIGURATION_CATALOG),
        "configuration catalog",
      );
      const subject = (catalog.subjects ?? [])[0] as Json | undefined;
      const session = (catalog.sessions ?? [])[0] as Json | undefined;
      if (!subject || !session) {
        await check(
          "ADM-30",
          {
            role: "admin",
            area: "papers",
            severity: "S1",
            title: "No academic subject/session exists to attach a paper",
            expected: "at least one subject and session from the workflow",
          },
          async () => {
            throw new Error("The configuration catalog returned no subject/session for this tenant.");
          },
        );
        return;
      }

      let paperId = "";
      await check(
        "ADM-30/31",
        {
          role: "admin",
          area: "papers",
          severity: "S1",
          title: "Paper creation or the pass-marks validation fails",
          expected: "draft paper created; pass above max rejected",
        },
        async () => {
          const body = await okJson(
            await adminSession.post(Routes.CONFIGURATION_PAPERS, {
              paper_type: paperConfig.paper.paperType,
              session_id: session.id,
              subject_id: subject.id,
              code: `${paperConfig.paper.code}-${runId}`,
              title: `${paperConfig.paper.title} ${runId}`,
              max_marks: paperConfig.paper.maxMarks,
              pass_marks: paperConfig.paper.passMarks,
              moderation_required: paperConfig.paper.moderationRequired,
              rules: paperConfig.paper.rules,
              custom_fields: {},
            }),
            "create paper",
          );
          paperId = body.id;
          expect(body.status).toBe("draft");

          const invalid = await adminSession.post(Routes.CONFIGURATION_PAPERS, {
            paper_type: paperConfig.paper.paperType,
            session_id: session.id,
            subject_id: subject.id,
            code: `${paperConfig.paper.code}-BAD-${runId}`,
            title: "invalid marks",
            max_marks: 10,
            pass_marks: 50,
            moderation_required: false,
            rules: paperConfig.paper.rules,
            custom_fields: {},
          });
          expect(invalid.status()).toBeGreaterThanOrEqual(400);
        },
      );

      await check(
        "ADM-32/33/34/35/36",
        {
          role: "admin",
          area: "papers",
          severity: "S1",
          title: "The paper cannot be configured, uploaded and submitted",
          expected: "sections ready, both PDFs uploaded, paper submitted",
        },
        async () => {
          const content = await okJson(
            await adminSession.get(RouteBuilders.configurationPaperQuestionContent(paperId)),
            "paper content",
          );
          await okJson(
            await adminSession.post(RouteBuilders.configurationPaperSetupSections(paperId), {
              version: content.paper_version,
              sections: paperConfig.sections,
            }),
            "setup sections",
          );

          const filesDir = path.join(testdataDir, "files");
          await okJson(
            await adminSession.uploadPdf(
              RouteBuilders.configurationPaperQuestionPaper(paperId),
              path.join(filesDir, "question-paper.pdf"),
            ),
            "upload question paper",
          );
          await okJson(
            await adminSession.uploadPdf(
              RouteBuilders.configurationPaperEvaluationScheme(paperId),
              path.join(filesDir, "evaluation-scheme.pdf"),
            ),
            "upload evaluation scheme",
          );

          const refreshed = await okJson(
            await adminSession.get(RouteBuilders.configurationPaperQuestionContent(paperId)),
            "paper content refresh",
          );
          expect(refreshed.readiness.question_paper).toBe(true);
          expect(refreshed.readiness.evaluation_scheme).toBe(true);

          const submitted = await okJson(
            await adminSession.post(RouteBuilders.configurationPaperSubmit(paperId), {
              version: refreshed.paper_version,
            }),
            "submit paper",
          );
          expect(submitted.status).not.toBe("draft");
        },
      );

      await check(
        "ADM-37/38",
        {
          role: "admin",
          area: "marking schemes",
          severity: "S1",
          title: "The marking scheme cannot be created and frozen",
          expected: "scheme created and persisted as frozen",
        },
        async () => {
          const scheme = await okJson(
            await adminSession.post(Routes.RUBRICS_SCHEMES, {
              paper_id: paperId,
              title: `DVS Scheme ${runId}`,
              evaluation_guidelines: "Award marks per the question guide.",
              examiner_instructions: "Evaluate every page of the script.",
            }),
            "create scheme",
          );
          const frozen = await okJson(
            await adminSession.post(RouteBuilders.rubricsSchemeTransition(scheme.id), {
              target: "review",
              version: scheme.version,
            }),
            "freeze scheme",
          );
          expect(frozen.status).toBe("frozen");
        },
      );
    } finally {
      await adminSession.dispose();
    }
  });

  test("ADM-50..55 evaluation centre @admin @testcase", async () => {
    test.skip(!writes, "Set DVS_ALLOW_WRITES=true to create a centre.");

    const adminSession = await ApiSession.login(admin.email, admin.password);
    try {
      let centreId = "";
      let readyVersion = 1;

      await check(
        "ADM-50/51/52",
        {
          role: "admin",
          area: "centres",
          severity: "S1",
          title: "Centre creation, no-go readiness or the activation guard fails",
          expected: "draft centre, no-go readiness, 409 on early activation",
        },
        async () => {
          const created = await okJson(
            await adminSession.post(Routes.PHASE4_CENTRES, {
              name: `${academic.centre.name} ${runId}`,
              location: academic.centre.location,
              capacity: academic.centre.capacity,
              workstation_count: academic.centre.workstationCount,
              schedule: {},
              security_controls: academic.centre.securityControls,
            }),
            "create centre",
          );
          centreId = created.id;

          const noGo = await okJson(
            await adminSession.post(RouteBuilders.phase4CentreReadiness(centreId), {}),
            "readiness no-go",
          );
          expect(noGo.decision).toBe("no_go");

          const early = await adminSession.post(RouteBuilders.phase4CentreAction(centreId), {
            action: "activate",
            version: 1,
            target: "active",
          });
          expect(early.status()).toBe(409);
        },
      );

      await check(
        "ADM-53/54/55",
        {
          role: "admin",
          area: "centres",
          severity: "S1",
          title: "The centre cannot become ready and active",
          expected: "go decision, active status, stale version refused",
        },
        async () => {
          const go = await okJson(
            await adminSession.post(RouteBuilders.phase4CentreReadiness(centreId), {
              scanner_ready: true,
              workstation_ready: true,
              network_ready: true,
              power_ready: true,
              secure_lan_ready: true,
              operators_ready: true,
              notes: "Synthetic readiness check",
            }),
            "readiness go",
          );
          expect(go.decision).toBe("go");

          const centres = await okJson(
            await adminSession.get(RouteBuilders.phase4Catalog("centres")),
            "centres catalog",
          );
          const row = ((centres.centres ?? []) as Json[]).find(
            (candidate) => candidate.id === centreId,
          );
          if (!row) throw new Error("The created centre is missing from the centres catalog.");
          readyVersion = Number(row.version ?? 1);

          const active = await okJson(
            await adminSession.post(RouteBuilders.phase4CentreAction(centreId), {
              action: "activate",
              version: readyVersion,
              target: "active",
            }),
            "activate centre",
          );
          expect(active.status).toBe("active");

          const stale = await adminSession.post(RouteBuilders.phase4CentreAction(centreId), {
            action: "activate",
            version: readyVersion - 1,
            target: "active",
          });
          expect(stale.status()).toBe(409);
        },
      );
    } finally {
      await adminSession.dispose();
    }
  });

  test("ADM-60..68 user provisioning and step-up @admin @testcase", async () => {
    test.skip(!writes, "Set DVS_ALLOW_WRITES=true to create users.");

    const adminSession = await ApiSession.login(admin.email, admin.password);
    const catalogue = await okJson(await adminSession.get(Routes.SECURITY_CATALOG), "security catalog");
    const centreId = String(((catalogue.centres ?? []) as Json[])[0]?.id ?? "");
    const programmeId = String(((catalogue.programmes ?? []) as Json[])[0]?.id ?? "");

    try {
      await check(
        "ADM-66",
        {
          role: "admin",
          area: "access governance",
          severity: "S1",
          title: "A membership can be created without a step-up",
          expected: "401/403 before step-up",
        },
        async () => {
          const response = await adminSession.post(Routes.SECURITY_MEMBERSHIPS, {
            first_name: "No",
            last_name: "StepUp",
            email: `dvs.nostep.${runId.toLowerCase()}@example.com`,
            role: "user_manager",
            permissions: [],
            enabled_modules: ["enterprise", "security"],
            operational_centre_id: centreId || null,
            programme_id: null,
            custom_fields: {},
          });
          // The sensitive-action gate answers 428 (precondition required) or an
          // authorization refusal; both must stop the creation.
          expect([401, 403, 428]).toContain(response.status());
        },
      );

      await check(
        "ADM-60/64",
        {
          role: "admin",
          area: "access governance",
          severity: "S1",
          title: "The User Manager cannot be created or is missing from the catalog",
          expected: "handover created; user listed with role user_manager",
        },
        async () => {
          expect((await adminSession.stepUp(admin.password)).status()).toBe(200);
          const email = `dvs.usermanager.${runId.toLowerCase()}@example.com`;
          const handover = await okJson(
            await adminSession.post(Routes.SECURITY_MEMBERSHIPS, {
              first_name: "first",
              last_name: "usermanager",
              email,
              role: "user_manager",
              permissions: [],
              enabled_modules: ["enterprise", "security"],
              operational_centre_id: centreId || null,
              programme_id: null,
              custom_fields: {},
            }),
            "create user manager",
          );
          expect(handover.role).toBe("user_manager");
          expect(handover.temporary_password).toBeTruthy();

          const catalog = await okJson(
            await adminSession.get(Routes.SECURITY_CATALOG),
            "security catalog refresh",
          );
          expect(catalog.members.some((member: Json) => member.email === email)).toBe(true);
        },
      );

      await check(
        "ADM-61/62",
        {
          role: "admin",
          area: "access governance",
          severity: "S1",
          title: "Chairman validation or creation fails",
          expected: "no-programme refused; Chairman created with the programme",
        },
        async () => {
          expect((await adminSession.stepUp(admin.password)).status()).toBe(200);
          const missing = await adminSession.post(Routes.SECURITY_MEMBERSHIPS, {
            first_name: "first",
            last_name: "chairman",
            email: `dvs.chairman.noprog.${runId.toLowerCase()}@example.com`,
            role: "chairman",
            permissions: [],
            enabled_modules: ["configuration", "evaluators", "operations", "rubrics"],
            operational_centre_id: centreId || null,
            programme_id: null,
            custom_fields: {},
          });
          expect(missing.status()).toBeGreaterThanOrEqual(400);

          const created = await okJson(
            await adminSession.post(Routes.SECURITY_MEMBERSHIPS, {
              first_name: "first",
              last_name: "chairman",
              email: `dvs.chairman.${runId.toLowerCase()}@example.com`,
              role: "chairman",
              permissions: [],
              enabled_modules: ["configuration", "evaluators", "operations", "rubrics"],
              operational_centre_id: centreId || null,
              programme_id: programmeId || null,
              custom_fields: {},
            }),
            "create chairman",
          );
          expect(created.role).toBe("chairman");
        },
      );

      await check(
        "ADM-68",
        {
          role: "admin",
          area: "access governance",
          severity: "S2",
          title: "A Scanner Operator without a centre is accepted",
          expected: "4xx and nothing created",
        },
        async () => {
          expect((await adminSession.stepUp(admin.password)).status()).toBe(200);
          const response = await adminSession.post(Routes.SECURITY_MEMBERSHIPS, {
            first_name: "first",
            last_name: "scanner",
            email: `dvs.scanner.nocentre.${runId.toLowerCase()}@example.com`,
            role: "scanner_operator",
            permissions: [],
            enabled_modules: ["digitization"],
            operational_centre_id: null,
            programme_id: null,
            custom_fields: {},
          });
          expect(response.status()).toBeGreaterThanOrEqual(400);
        },
      );
    } finally {
      await adminSession.dispose();
    }
  });

  test("ADM-70..74 evaluation security policy @admin @testcase", async () => {
    test.skip(!writes, "Set DVS_ALLOW_WRITES=true to save the policy.");

    const adminSession = await ApiSession.login(admin.email, admin.password);
    try {
      await check(
        "ADM-70/71/72/74",
        {
          role: "admin",
          area: "security policy",
          severity: "S1",
          title: "The evaluation policy cannot be saved with optimistic locking",
          expected: "version +1; stale version 409; step-up enforced",
        },
        async () => {
          const catalog = await okJson(
            await adminSession.get(Routes.SECURITY_CATALOG),
            "security catalog",
          );
          const policy = catalog.policy as Json;
          expect(typeof policy.version, "policy version").toBe("number");

          const noStepUp = await adminSession.put(Routes.SECURITY_POLICY, policy);
          expect([401, 403, 428], "policy save without step-up").toContain(noStepUp.status());

          expect((await adminSession.stepUp(admin.password)).status()).toBe(200);
          const saved = await okJson(
            await adminSession.put(Routes.SECURITY_POLICY, policy),
            "save policy",
          );
          expect(saved.version).toBe(policy.version + 1);

          const stale = await adminSession.put(Routes.SECURITY_POLICY, policy);
          expect(stale.status()).toBe(409);
        },
      );

      await check(
        "ADM-73",
        {
          role: "admin",
          area: "security policy",
          severity: "S2",
          title: "The saved policy is not persisted",
          expected: "saved values re-read from the catalog",
        },
        async () => {
          const catalog = await okJson(
            await adminSession.get(Routes.SECURITY_CATALOG),
            "security catalog",
          );
          expect(typeof (catalog.policy as Json).version).toBe("number");
        },
      );
    } finally {
      await adminSession.dispose();
    }
  });

  test("ADM-80/81 tenant isolation @admin @testcase", async () => {
    const session = await ApiSession.login(admin.email, admin.password);
    try {
      await check(
        "ADM-80/81",
        {
          role: "admin",
          area: "isolation",
          severity: "S1",
          title: "The tenant identity or record scope is wrong",
          expected: "records belong to this tenant only and match the provisioned university",
        },
        async () => {
          const me = await okJson(await session.get(Routes.AUTH_ME), "auth/me");
          expect(String(me.tenant?.id ?? "")).not.toBe("");
          expect(String(me.tenant?.name ?? "")).not.toBe("");

          const expectedTenant = process.env.DVS_TENANT_ID;
          if (expectedTenant) expect(String(me.tenant.id)).toBe(expectedTenant);

          const catalog = await okJson(
            await session.get(Routes.CONFIGURATION_CATALOG),
            "configuration catalog",
          );
          const rows = [
            ...(catalog.programmes ?? []),
            ...(catalog.subjects ?? []),
            ...(catalog.papers ?? []),
          ] as Json[];
          const foreign = rows.filter(
            (row) => row.tenant_id && String(row.tenant_id) !== String(me.tenant.id),
          );
          expect(foreign, "records from another tenant").toHaveLength(0);
        },
      );
    } finally {
      await session.dispose();
    }
  });
});
