import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { createHash, randomUUID } from "crypto";
import { test, expect } from "@playwright/test";
import { Routes, RouteBuilders } from "../../../api/endpoints/routes";
import {
  ApiSession,
  completeFirstLogin,
  okJson,
  rel,
  schemaErrors,
  type Json,
} from "../../../utils/apiClient";
import { saveRunState, upsertEnv } from "../../../utils/runState";

/**
 * DVS role-based end-to-end workflow (API).
 * Admin -> User Manager -> Chairman -> Chief -> Evaluator -> Scanner Operator -> allocation.
 *
 * Source: prompts/KTR_API_TEST_PROMPTS.md sections 4, 5, 6, 7, 9 and 13.
 * Creates synthetic records on the configured tenant, so it is gated behind
 * DVS_ALLOW_WRITES=true. Temporary passwords stay in memory; the permanent password
 * for every provisioned user is DVS_ROLE_NEW_PASSWORD.
 */
const testdataDir = path.resolve(__dirname, "..", "..", "..", "testdata");
const readJson = (file: string): Json => JSON.parse(fs.readFileSync(path.join(testdataDir, file), "utf-8"));

const academic = readJson("dvs_academic_config.json");
const paperConfig = readJson("dvs_paper_config.json");
const provisioning = readJson("dvs_user_provisioning.json");
const filesDir = path.join(testdataDir, "files");

// 1x1 PNG used as a synthetic scanned page.
const PAGE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const adminEmail = process.env.DVS_ADMIN_EMAIL ?? "";
const adminPassword = process.env.DVS_ADMIN_PASSWORD ?? "";
const rolePassword = process.env.DVS_ROLE_NEW_PASSWORD ?? "";
const runId = Date.now().toString(36).toLowerCase();
const upper = runId.toUpperCase();
const mail = (prefix: string) => `${prefix}.${runId}@example.com`;
const roleProfile = (role: string) => provisioning.membershipRoles.find((r: Json) => r.role === role);
const evaluatorProfile = (kind: string) => provisioning.evaluatorProfiles.find((p: Json) => p.kind === kind);

interface RunContext {
  admin?: ApiSession;
  userManager?: ApiSession;
  chairman?: ApiSession;
  chief?: ApiSession;
  evaluator?: ApiSession;
  scanner?: ApiSession;
  ids: Record<string, string>;
  emails: Record<string, string>;
}

const ctx: RunContext = { ids: {}, emails: {} };

/** Creates a membership through the sensitive-action gate and returns the handover payload. */
async function createMembership(actor: ApiSession, actorPassword: string, body: Json): Promise<Json> {
  expect((await actor.stepUp(actorPassword)).status(), "step-up before user creation").toBe(200);
  return okJson(await actor.post(Routes.SECURITY_MEMBERSHIPS, body), `create ${body.role}`);
}

test.describe.serial("DVS role-based workflow @master @api @end-to-end", () => {
  test.skip(!process.env.DVS_API_BASE_URL, "Set DVS_API_BASE_URL in .env.");
  test.skip(!adminEmail || !adminPassword, "Set DVS_ADMIN_EMAIL and DVS_ADMIN_PASSWORD in .env.");
  test.skip(!rolePassword, "Set DVS_ROLE_NEW_PASSWORD in .env.");
  test.skip(process.env.DVS_ALLOW_WRITES !== "true", "Set DVS_ALLOW_WRITES=true to create synthetic records.");

  test.afterAll(async () => {
    for (const session of [ctx.admin, ctx.userManager, ctx.chairman, ctx.chief, ctx.evaluator, ctx.scanner]) {
      await session?.dispose();
    }
  });

  test("1) Admin signs in and builds the academic chain", async () => {
    await test.step("1.1) login", async () => {
      ctx.admin = await ApiSession.login(adminEmail, adminPassword);
      expect(ctx.admin.loginResponse.status()).toBe(200);
    });
    const admin = ctx.admin!;

    await test.step("1.2) programme", async () => {
      const body = await okJson(
        await admin.post(Routes.CONFIGURATION_PROGRAMMES, {
          code: `${academic.programme.code}-${upper}`,
          name: `${academic.programme.name} ${upper}`,
        }),
        "create programme",
      );
      ctx.ids.programme = body.id;
      expect(ctx.ids.programme).toBeTruthy();
    });

    await test.step("1.3) regulation mapped to the programme", async () => {
      const body = await okJson(
        await admin.post(Routes.CONFIGURATION_REGULATIONS, {
          code: `${academic.regulation.code}-${upper}`,
          title: `${academic.regulation.title} ${upper}`,
          programme_ids: [ctx.ids.programme],
        }),
        "create regulation",
      );
      ctx.ids.regulation = body.id;
    });

    await test.step("1.4) academic year", async () => {
      const body = await okJson(
        await admin.post(Routes.CONFIGURATION_ACADEMIC_YEARS, {
          regulation_id: ctx.ids.regulation,
          label: academic.academicYear.label,
        }),
        "create academic year",
      );
      ctx.ids.academicYear = body.id;
    });

    await test.step("1.5) exam session", async () => {
      const body = await okJson(
        await admin.post(Routes.CONFIGURATION_SESSIONS, {
          programme_id: ctx.ids.programme,
          academic_year_id: ctx.ids.academicYear,
          name: `${academic.examSession.name} ${upper}`,
        }),
        "create session",
      );
      ctx.ids.session = body.id;
      expect(body.version).toBe(1);
    });

    await test.step("1.6) course", async () => {
      const body = await okJson(
        await admin.post(Routes.CONFIGURATION_COURSES, {
          programme_id: ctx.ids.programme,
          regulation_id: ctx.ids.regulation,
          code: `${academic.course.code}-${upper}`,
          name: `${academic.course.name} ${upper}`,
        }),
        "create course",
      );
      ctx.ids.course = body.id;
    });

    await test.step("1.7) subject", async () => {
      const body = await okJson(
        await admin.post(Routes.CONFIGURATION_SUBJECTS, {
          programme_id: ctx.ids.programme,
          regulation_id: ctx.ids.regulation,
          academic_year_id: ctx.ids.academicYear,
          course_id: ctx.ids.course,
          semester: academic.subject.semester,
          session_ids: [ctx.ids.session],
          code: `${academic.subject.code}-${upper}`,
          name: `${academic.subject.name} ${upper}`,
        }),
        "create subject",
      );
      ctx.ids.subject = body.id;
    });

    await test.step("1.8) catalog shows every created record", async () => {
      const catalog = await okJson(await admin.get(Routes.CONFIGURATION_CATALOG), "configuration catalog");
      const has = (rows: Json[], id: string) => rows.some((row) => row.id === id);
      expect(has(catalog.programmes, ctx.ids.programme)).toBe(true);
      expect(has(catalog.regulations, ctx.ids.regulation)).toBe(true);
      expect(has(catalog.academic_years, ctx.ids.academicYear)).toBe(true);
      expect(has(catalog.sessions, ctx.ids.session)).toBe(true);
      expect(has(catalog.courses, ctx.ids.course)).toBe(true);
      expect(has(catalog.subjects, ctx.ids.subject)).toBe(true);
    });
  });

  test("2) Admin configures the paper, documents and marking scheme", async () => {
    const admin = ctx.admin!;
    const cfg = paperConfig.paper;
    let paperVersion = 1;

    await test.step("2.1) create paper", async () => {
      const body = await okJson(
        await admin.post(Routes.CONFIGURATION_PAPERS, {
          paper_type: cfg.paperType,
          session_id: ctx.ids.session,
          subject_id: ctx.ids.subject,
          code: `${cfg.code}-${upper}`,
          title: `${cfg.title} ${upper}`,
          max_marks: cfg.maxMarks,
          pass_marks: cfg.passMarks,
          moderation_required: cfg.moderationRequired,
          rules: cfg.rules,
          custom_fields: {},
        }),
        "create paper",
      );
      ctx.ids.paper = body.id;
      expect(body.status).toBe("draft");
      paperVersion = body.version;
    });

    await test.step("2.2) negative: pass marks above max marks are rejected", async () => {
      const response = await admin.post(Routes.CONFIGURATION_PAPERS, {
        paper_type: cfg.paperType,
        session_id: ctx.ids.session,
        subject_id: ctx.ids.subject,
        code: `${cfg.code}-BAD-${upper}`,
        title: "invalid marks",
        max_marks: 10,
        pass_marks: 50,
        moderation_required: false,
        rules: cfg.rules,
        custom_fields: {},
      });
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
    });

    await test.step("2.3) setup sections", async () => {
      const body = await okJson(
        await admin.post(RouteBuilders.configurationPaperSetupSections(ctx.ids.paper), {
          version: paperVersion,
          sections: paperConfig.sections,
        }),
        "setup sections",
      );
      expect(body.readiness.ready).toBe(true);
      expect(body.questions).toHaveLength(24);
    });

    await test.step("2.4) upload question paper and evaluation scheme PDFs", async () => {
      const qp = await okJson(
        await admin.uploadPdf(
          RouteBuilders.configurationPaperQuestionPaper(ctx.ids.paper),
          path.join(filesDir, "question-paper.pdf"),
        ),
        "upload question paper",
      );
      expect(qp.document.kind).toBe("question_paper");
      const scheme = await okJson(
        await admin.uploadPdf(
          RouteBuilders.configurationPaperEvaluationScheme(ctx.ids.paper),
          path.join(filesDir, "evaluation-scheme.pdf"),
        ),
        "upload evaluation scheme",
      );
      expect(scheme.document.kind).toBe("evaluation_scheme");
    });

    await test.step("2.5) submit the paper at its latest version", async () => {
      const content = await okJson(
        await admin.get(RouteBuilders.configurationPaperQuestionContent(ctx.ids.paper)),
        "question content",
      );
      expect(schemaErrors("configuration_question_content", content)).toBe("");
      expect(content.readiness.question_paper).toBe(true);
      expect(content.readiness.evaluation_scheme).toBe(true);
      expect(content.readiness.total_questions).toBe(24);

      const submitted = await okJson(
        await admin.post(RouteBuilders.configurationPaperSubmit(ctx.ids.paper), {
          version: content.paper_version,
        }),
        "submit paper",
      );
      expect(submitted.status).not.toBe("draft");
    });

    await test.step("2.6) marking scheme is created and frozen", async () => {
      const scheme = await okJson(
        await admin.post(Routes.RUBRICS_SCHEMES, {
          paper_id: ctx.ids.paper,
          title: `DVS Scheme ${upper}`,
          evaluation_guidelines: "Award marks per the question guide.",
          examiner_instructions: "Evaluate every page of the script.",
        }),
        "create scheme",
      );
      ctx.ids.scheme = scheme.id;
      expect(scheme.status).toBe("draft");

      const transition = await okJson(
        await admin.post(RouteBuilders.rubricsSchemeTransition(scheme.id), {
          target: "review",
          version: scheme.version,
        }),
        "scheme transition",
      );
      expect(transition.status).toBe("frozen");

      const catalog = await okJson(await admin.get(Routes.RUBRICS_CATALOG), "rubrics catalog");
      const stored = catalog.schemes.find((s: Json) => s.id === scheme.id);
      expect(stored?.status).toBe("frozen");
    });
  });

  test("3) Admin creates, readiness-checks and activates the evaluation centre", async () => {
    const admin = ctx.admin!;
    const centre = academic.centre;

    await test.step("3.1) create centre", async () => {
      const body = await okJson(
        await admin.post(Routes.PHASE4_CENTRES, {
          name: `${centre.name} ${upper}`,
          location: centre.location,
          capacity: centre.capacity,
          workstation_count: centre.workstationCount,
          schedule: {},
          security_controls: centre.securityControls,
        }),
        "create centre",
      );
      ctx.ids.centre = body.id;
      expect(body.status).toBe("draft");
    });

    await test.step("3.2) readiness with no checks passed is no-go", async () => {
      const body = await okJson(
        await admin.post(RouteBuilders.phase4CentreReadiness(ctx.ids.centre), {}),
        "readiness no-go",
      );
      expect(body.decision).toBe("no_go");
      expect(body.centre_status).toBe("draft");
    });

    await test.step("3.3) activating a non-ready centre is rejected", async () => {
      const response = await admin.post(RouteBuilders.phase4CentreAction(ctx.ids.centre), {
        action: "activate",
        version: 1,
        target: "active",
      });
      expect(response.status()).toBe(409);
    });

    await test.step("3.4) readiness with every check passed is go", async () => {
      const body = await okJson(
        await admin.post(RouteBuilders.phase4CentreReadiness(ctx.ids.centre), {
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
      expect(body.decision).toBe("go");
      expect(body.centre_status).toBe("ready");
    });

    await test.step("3.5) activate and verify through the catalog", async () => {
      const lookup = async () => {
        const catalog = await okJson(await admin.get(RouteBuilders.phase4Catalog("centres")), "centres catalog");
        return catalog.centres.find((c: Json) => c.id === ctx.ids.centre) as Json;
      };
      const before = await lookup();
      const action = await okJson(
        await admin.post(RouteBuilders.phase4CentreAction(ctx.ids.centre), {
          action: "activate",
          version: before.version,
          target: "active",
        }),
        "activate centre",
      );
      expect(action.status).toBe("active");
      expect((await lookup()).status).toBe("active");
    });
  });

  test("4) Admin updates the security policy with optimistic locking", async () => {
    const admin = ctx.admin!;
    const catalog = await okJson(await admin.get(Routes.SECURITY_CATALOG), "security catalog");
    const policy = catalog.policy as Json;
    expect((await admin.stepUp(adminPassword)).status()).toBe(200);

    await test.step("4.1) save the current policy and the version increments by one", async () => {
      const saved = await okJson(await admin.put(Routes.SECURITY_POLICY, policy), "save policy");
      expect(saved.version).toBe(policy.version + 1);
    });

    await test.step("4.2) a stale version is rejected", async () => {
      const stale = await admin.put(Routes.SECURITY_POLICY, policy);
      expect(stale.status()).toBe(409);
    });
  });

  test("5) Admin provisions the User Manager and the Chairman", async () => {
    const admin = ctx.admin!;
    let chairmanTemporaryPassword = "";

    await test.step("5.1) create the User Manager and complete first login", async () => {
      const profile = roleProfile("user_manager");
      const email = mail(profile.emailPrefix);
      const handover = await createMembership(admin, adminPassword, {
        first_name: profile.firstName,
        last_name: profile.lastName,
        email,
        role: "user_manager",
        permissions: profile.permissions,
        enabled_modules: profile.enabledModules,
        operational_centre_id: ctx.ids.centre,
        programme_id: null,
        custom_fields: {},
      });
      expect(handover.role).toBe("user_manager");
      expect(handover.programme_id).toBeNull();
      ctx.emails.userManager = email;
      ctx.userManager = await completeFirstLogin(email, handover.temporary_password, rolePassword);
      const me = await okJson(await ctx.userManager.get(Routes.AUTH_ME), "user manager me");
      expect(me.role).toBe("user_manager");
    });

    await test.step("5.2) a Chairman without a programme is rejected", async () => {
      expect((await admin.stepUp(adminPassword)).status()).toBe(200);
      const profile = roleProfile("chairman");
      const response = await admin.post(Routes.SECURITY_MEMBERSHIPS, {
        first_name: profile.firstName,
        last_name: profile.lastName,
        email: mail(`${profile.emailPrefix}.noprog`),
        role: "chairman",
        permissions: [],
        enabled_modules: profile.enabledModules,
        operational_centre_id: ctx.ids.centre,
        programme_id: null,
        custom_fields: {},
      });
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
    });

    await test.step("5.3) create the Chairman and complete first login", async () => {
      const profile = roleProfile("chairman");
      const email = mail(profile.emailPrefix);
      const handover = await createMembership(admin, adminPassword, {
        first_name: profile.firstName,
        last_name: profile.lastName,
        email,
        role: "chairman",
        permissions: profile.permissions,
        enabled_modules: profile.enabledModules,
        operational_centre_id: ctx.ids.centre,
        programme_id: ctx.ids.programme,
        custom_fields: {},
      });
      expect(handover.programme_id).toBe(ctx.ids.programme);
      ctx.emails.chairman = email;
      chairmanTemporaryPassword = handover.temporary_password;
      ctx.chairman = await completeFirstLogin(email, chairmanTemporaryPassword, rolePassword);
    });

    await test.step("5.4) the single-use temporary password is no longer accepted", async () => {
      const reuse = await ApiSession.login(ctx.emails.chairman, chairmanTemporaryPassword);
      expect(reuse.loginResponse.status()).toBe(401);
      await reuse.dispose();
    });

    await test.step("5.5) both users appear in the security catalog with the intended role", async () => {
      const catalog = await okJson(await admin.get(Routes.SECURITY_CATALOG), "security catalog");
      const member = (email: string) => catalog.members.find((m: Json) => m.email === email);
      expect(member(ctx.emails.userManager)?.role).toBe("user_manager");
      expect(member(ctx.emails.chairman)?.role).toBe("chairman");
    });
  });

  test("6) Chairman registers a Chief Examiner and nominates the Chief", async () => {
    const chairman = ctx.chairman!;
    const profile = evaluatorProfile("chief");
    const email = mail(profile.emailPrefix);
    let evaluatorId = "";
    let handover: Json = {};

    await test.step("6.1) catalog lists the subject", async () => {
      const catalog = await okJson(await chairman.get(Routes.CHAIRMAN_CATALOG), "chairman catalog");
      expect(schemaErrors("chairman_catalog", catalog)).toBe("");
      expect(catalog.subjects.some((s: Json) => s.id === ctx.ids.subject)).toBe(true);
    });

    await test.step("6.2) a Chairman cannot register a non-chief", async () => {
      const response = await chairman.post(Routes.EVALUATOR_MANAGEMENT, {
        display_name: "Not a chief",
        email: mail("dvs.notchief"),
        institution_name: profile.institutionName,
        department: profile.department,
        years_experience: 1,
        employment_type: "permanent",
        subject_ids: [ctx.ids.subject],
      });
      expect(response.status()).toBe(403);
    });

    await test.step("6.3) register the Chief profile", async () => {
      const body = await okJson(
        await chairman.post(Routes.EVALUATOR_MANAGEMENT, {
          display_name: profile.displayName,
          email,
          institution_name: profile.institutionName,
          department: profile.department,
          years_experience: profile.yearsExperience,
          mobile: "",
          employee_id: `${profile.employeeId}-${upper}`,
          designation: profile.designation,
          qualification: profile.qualification,
          employment_type: profile.employmentType.toLowerCase(),
          grade: "chief",
          subject_ids: [ctx.ids.subject],
        }),
        "register chief",
      );
      expect(schemaErrors("evaluator_profile", body)).toBe("");
      expect(body.role).toBe("chief");
      expect(body.login_enabled).toBe(false);
      evaluatorId = body.id;
      ctx.ids.chiefProfile = body.id;
      ctx.emails.chief = email;
    });

    await test.step("6.4) nominate the Chief; credentials are issued", async () => {
      const catalog = await okJson(
        await chairman.get(RouteBuilders.chairmanCatalog(ctx.ids.subject)),
        "chairman catalog by subject",
      );
      const row = catalog.rows.find((r: Json) => r.evaluator_id === evaluatorId);
      expect(row?.can_nominate).toBe(true);

      handover = await okJson(
        await chairman.post(Routes.CHAIRMAN_NOMINATIONS, { subject_id: ctx.ids.subject, evaluator_id: evaluatorId }),
        "nominate chief",
      );
      expect(schemaErrors("chairman_nomination", handover)).toBe("");
      expect(handover.status).toBe("pending");
      ctx.ids.nomination = handover.id;
    });

    await test.step("6.5) Chief completes first login", async () => {
      ctx.chief = await completeFirstLogin(email, handover.credentials.temporary_password, rolePassword);
      const me = await okJson(await ctx.chief.get(Routes.AUTH_ME), "chief me");
      expect(me.evaluator_grade).toBe("chief");
    });
  });

  test("7) Chief accepts the nomination and registers the Evaluator", async () => {
    const chief = ctx.chief!;
    const profile = evaluatorProfile("evaluator");
    const email = mail(profile.emailPrefix);
    let evaluatorId = "";

    await test.step("7.1) the nomination is pending and restricted scope is empty", async () => {
      const before = await okJson(await chief.get(Routes.CHIEF_SUMMARY), "chief summary before");
      expect(before.ready).toBe(false);
      expect(before.subjects).toHaveLength(0);

      const mine = await okJson(await chief.get(Routes.CHAIRMAN_MY_NOMINATIONS), "my nominations");
      const nomination = mine.items.find((n: Json) => n.id === ctx.ids.nomination);
      expect(nomination?.status).toBe("pending");
      expect(nomination?.can_accept).toBe(true);
    });

    await test.step("7.2) accept the nomination", async () => {
      const accepted = await okJson(
        await chief.post(RouteBuilders.chairmanNominationAccept(ctx.ids.nomination)),
        "accept nomination",
      );
      expect(accepted.status).toBe("completed");
    });

    await test.step("7.3) accepted subject scope unlocks", async () => {
      const after = await okJson(await chief.get(Routes.CHIEF_SUMMARY), "chief summary after");
      expect(after.ready).toBe(true);
      expect(after.subjects.map((s: Json) => s.id)).toContain(ctx.ids.subject);
    });

    await test.step("7.4) register the Evaluator profile", async () => {
      const body = await okJson(
        await chief.post(Routes.EVALUATOR_MANAGEMENT, {
          display_name: profile.displayName,
          email,
          institution_name: profile.institutionName,
          department: profile.department,
          years_experience: profile.yearsExperience,
          mobile: "",
          employee_id: `${profile.employeeId}-${upper}`,
          designation: profile.designation,
          qualification: profile.qualification,
          employment_type: profile.employmentType.toLowerCase(),
          subject_ids: [ctx.ids.subject],
        }),
        "register evaluator",
      );
      expect(body.role).toBe("evaluator");
      expect(body.login_enabled).toBe(false);
      evaluatorId = body.id;
      ctx.ids.evaluatorProfile = body.id;
      ctx.emails.evaluator = email;
    });

    await test.step("7.5) the registered Evaluator is listed in the Chief's team", async () => {
      const team = await okJson(await chief.get(Routes.EVALUATOR_TEAM), "chief team");
      expect(schemaErrors("evaluator_team", team)).toBe("");
      expect(team.assigned_evaluators.map((e: Json) => e.id)).toContain(evaluatorId);
    });

    await test.step("7.6) nominate the Evaluator and complete first login", async () => {
      const nominated = await okJson(
        await chief.post(Routes.CHIEF_TEAM_NOMINATIONS, { evaluator_id: evaluatorId, subject_id: ctx.ids.subject }),
        "nominate evaluator",
      );
      expect(nominated.nominated).toBe(true);
      ctx.evaluator = await completeFirstLogin(email, nominated.credentials.temporary_password, rolePassword);
      const me = await okJson(await ctx.evaluator.get(Routes.AUTH_ME), "evaluator me");
      expect(me.role).toBe("evaluator");
      expect(me.face_login.required).toBe(true);
    });
  });

  test("8) User Manager provisions the Scanner Operator", async () => {
    const um = ctx.userManager!;
    const profile = roleProfile("scanner_operator");
    const email = mail(profile.emailPrefix);

    await test.step("8.1) a Scanner Operator without a centre is rejected", async () => {
      expect((await um.stepUp(rolePassword)).status()).toBe(200);
      const response = await um.post(Routes.SECURITY_MEMBERSHIPS, {
        first_name: profile.firstName,
        last_name: profile.lastName,
        email: mail(`${profile.emailPrefix}.nocentre`),
        role: "scanner_operator",
        permissions: [],
        enabled_modules: profile.enabledModules,
        operational_centre_id: null,
        programme_id: null,
        custom_fields: {},
      });
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
    });

    await test.step("8.2) create the Scanner Operator and complete first login", async () => {
      const handover = await createMembership(um, rolePassword, {
        first_name: profile.firstName,
        last_name: profile.lastName,
        email,
        role: "scanner_operator",
        permissions: profile.permissions,
        enabled_modules: profile.enabledModules,
        operational_centre_id: ctx.ids.centre,
        programme_id: null,
        custom_fields: {},
      });
      expect(handover.role).toBe("scanner_operator");
      expect(handover.enabled_modules).toEqual(profile.enabledModules);
      ctx.emails.scanner = email;
      ctx.scanner = await completeFirstLogin(email, handover.temporary_password, rolePassword);
    });

    await test.step("8.3) the Scanner sees its centre and the new paper", async () => {
      const catalog = await okJson(await ctx.scanner!.get(Routes.RECEIVING_GUIDED_CATALOG), "receiving catalog");
      expect(catalog.enabled).toBe(true);
      expect(catalog.centre.id).toBe(ctx.ids.centre);
      const papers = await okJson(await ctx.scanner!.get(Routes.RECEIVING_SUBJECT_PAPERS), "subject papers");
      expect(papers.papers.map((p: Json) => p.id)).toContain(ctx.ids.paper);
      const ours = papers.papers.find((p: Json) => p.id === ctx.ids.paper);
      expect(ours.pages_per_script).toBe(paperConfig.paper.pagesPerScript);
    });
  });

  test("9) Scanner Operator digitizes a script and submits the packet", async () => {
    const scanner = ctx.scanner!;
    const pages = paperConfig.paper.pagesPerScript as number;
    let script: Json = {};

    await test.step("9.1) register a script under the paper", async () => {
      script = await okJson(
        await scanner.post(Routes.RECEIVING_SUBJECT_SCRIPTS, {
          paper_id: ctx.ids.paper,
          idempotency_key: randomUUID(),
        }),
        "create script",
      );
      expect(schemaErrors("receiving_subject_scripts", script)).toBe("");
      expect(script.packet_size).toBe(paperConfig.paper.scriptsPerPacket);
      ctx.ids.script = script.script_id;
      ctx.ids.group = script.group_id;
    });

    await test.step("9.2) upload and finalize every page", async () => {
      const sha256 = createHash("sha256").update(PAGE_PNG).digest("hex");
      for (let page = 1; page <= pages; page++) {
        const intent = await okJson(
          await scanner.post(Routes.REPOSITORY_MANUAL_SCAN_UPLOAD, {
            script_id: script.script_id,
            page_number: page,
            content_type: "image/png",
            maximum_bytes: PAGE_PNG.length,
          }),
          `upload intent page ${page}`,
        );
        expect(schemaErrors("repository_upload_intent", intent)).toBe("");

        const put = await scanner.api.put(rel(intent.upload_url), { data: PAGE_PNG, headers: intent.headers });
        expect(put.status()).toBe(201);

        const finalized = await okJson(
          await scanner.post(RouteBuilders.repositoryUploadFinalize(intent.id), {
            version: intent.version,
            sha256,
            byte_size: PAGE_PNG.length,
          }),
          `finalize page ${page}`,
        );
        expect(finalized.status).toBe("completed");
        expect(finalized.sha256).toBe(sha256);
      }
    });

    await test.step("9.3) complete the scan with the expected page count", async () => {
      const done = await okJson(
        await scanner.post(RouteBuilders.repositoryScriptCompleteScan(script.script_id), {
          version: script.version,
          page_count: pages,
        }),
        "complete scan",
      );
      expect(done.state).toBe("scanned");
    });

    await test.step("9.4) processing finishes and the script is stored", async () => {
      await expect
        .poll(
          async () => {
            const body = await okJson(
              await scanner.get(RouteBuilders.receivingSubjectScripts(ctx.ids.paper)),
              "script status",
            );
            return body.groups[0].scripts[0].state;
          },
          { timeout: 90_000, intervals: [2_000] },
        )
        .toBe("stored");
    });

    await test.step("9.5) submit the packet", async () => {
      const submitted = await okJson(
        await scanner.post(RouteBuilders.receivingSubjectGroupSubmit(script.group_id)),
        "submit packet",
      );
      expect(schemaErrors("receiving_subject_group_submit", submitted)).toBe("");
      expect(submitted.submitted).toBe(true);
      expect(submitted.closed).toBe(true);
    });
  });

  test("10) Chief sees the ready packet; allocation is gated on evaluator attendance", async () => {
    const chief = ctx.chief!;
    let batch: Json = {};

    await test.step("10.1) the packet is ready in the Chief's batch", async () => {
      const batches = await okJson<Json[]>(await chief.get(Routes.ALLOCATION_EXAMINER_BATCHES), "examiner batches");
      batch = batches.find((b) => b.chief.id === ctx.ids.chiefProfile) as Json;
      expect(batch).toBeTruthy();

      const groups = await okJson(
        await chief.get(RouteBuilders.allocationSubjectGroups(batch.id)),
        "subject groups",
      );
      const group = groups.groups.find((g: Json) => g.group_id === ctx.ids.group);
      expect(group?.ready).toBe(true);
      expect(group?.submitted).toBe(true);
      expect(group?.stored_count).toBe(group?.total_count);
    });

    await test.step("10.2) an Evaluator without recorded attendance cannot be allocated", async () => {
      const member = batch.members.find((m: Json) => m.evaluator_id === ctx.ids.evaluatorProfile);
      expect(member?.packet_available).toBe(false);

      const response = await chief.post(RouteBuilders.allocationAllocateSubjectGroup(batch.id), {
        group_id: ctx.ids.group,
        member_id: member.id,
      });
      expect(response.status()).toBe(403);
      expect((await response.json()).detail).toContain("present");
    });

    await test.step("10.3) the Evaluator is held at face verification", async () => {
      const policy = await ctx.evaluator!.get(Routes.EVALUATOR_ENROLLMENT_POLICY);
      expect(policy.status()).toBe(428);
      expect((await policy.json()).code).toBe("face_login_required");
    });

    test.info().annotations.push({
      type: "blocked",
      description:
        "Packet allocation and evaluation need Evaluator face enrollment and a live face login (camera). " +
        "No synthetic path exists; complete those two steps in the UI, then allocate.",
    });
  });

  test("11) Persist the provisioned accounts for the Web role checks", async () => {
    upsertEnv({
      DVS_ALLOW_WRITES: "true",
      DVS_USER_MANAGER_EMAIL: ctx.emails.userManager,
      DVS_USER_MANAGER_PASSWORD: rolePassword,
      DVS_CHAIRMAN_EMAIL: ctx.emails.chairman,
      DVS_CHAIRMAN_PASSWORD: rolePassword,
      DVS_CHIEF_EMAIL: ctx.emails.chief,
      DVS_CHIEF_PASSWORD: rolePassword,
      DVS_EVALUATOR_EMAIL: ctx.emails.evaluator,
      DVS_EVALUATOR_PASSWORD: rolePassword,
      DVS_SCANNER_EMAIL: ctx.emails.scanner,
      DVS_SCANNER_PASSWORD: rolePassword,
    });
    saveRunState({ runId, emails: ctx.emails, ids: ctx.ids });
    expect(Object.keys(ctx.emails)).toHaveLength(5);
  });
});
