import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ApiSession, completeFirstLogin, okJson, type Json } from "../../../utils/apiClient";
import { RouteBuilders, Routes } from "../../../api/endpoints/routes";
import { readRunState, saveRunState, upsertEnv } from "../../../utils/runState";
import { completeAfterEvaluation, type WorkflowState } from "../../../utils/evaluationCompletion";
import {
  beginSecureMarking,
  logProgress,
  markAndSubmit,
  openEvaluatorWorkspace,
  relaxEvaluationPolicy,
  resetFaceFlag,
} from "../../../utils/liveEvaluation";
import { Helper } from "../../../utils/helper";
import {
  openWorkflowSummary,
  saveReportArtifact,
  saveReportDocs,
  saveWorkflowSummary,
} from "../../../utils/reportArtifact";

/**
 * Continuous end-to-end workflow: Platform Admin -> new university -> Admin
 * report receipt.
 *
 * This file is a workflow driver, not a test suite. It holds ONE ordered flow so
 * the chain cannot be split, skipped or reordered: each layer hands its result to
 * the next (`test.step`s are the only structure).
 *
 * Sources: prompts/KTR_API_TEST_PROMPTS.md §4-13 and prompts/KTR_WEB_TEST_PROMPTS.md §0.1-§17.
 */

/** Tenant origin of the university provisioned by the platform bootstrap. */
const tenantUrl = (process.env.WEB_APP_URL ?? "").replace(/\/+$/, "");
const adminEmail = process.env.DVS_ADMIN_EMAIL ?? "";
const adminPassword = process.env.DVS_ADMIN_PASSWORD ?? "";
const rolePassword = process.env.DVS_ROLE_NEW_PASSWORD ?? "";

const testdataDir = path.resolve(process.cwd(), "testdata");
const readJson = (file: string): Json =>
  JSON.parse(fs.readFileSync(path.join(testdataDir, file), "utf-8"));

const academic = readJson("dvs_academic_config.json");
const paperConfig = readJson("dvs_paper_config.json");
const provisioning = readJson("dvs_user_provisioning.json");

/** 1x1 PNG used as a synthetic scanned page. */
const PAGE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Run-scoped identifiers and role mailboxes handed between steps. */
type Flow = {
  ids: Record<string, string>;
  emails: Record<string, string>;
};

const flow: Flow = { ids: {}, emails: {} };
const sessions = new Map<string, ApiSession>();

/**
 * Signs in once per role and keeps the session for the rest of the flow.
 * @param role - Role key from the role inventory
 */
async function session(role: string): Promise<ApiSession> {
  const existing = sessions.get(role);
  if (existing) return existing;

  const keys = Helper.getRoleEnvironmentKey(role);
  const email = process.env[keys.email]?.trim() ?? "";
  const password = process.env[keys.password] ?? "";
  if (!email || !password) {
    throw new Error(
      `Missing ${keys.email} / ${keys.password}. Run the platform bootstrap so the Admin can provision ${role}.`,
    );
  }
  const created = await ApiSession.login(email, password);
  sessions.set(role, created);
  return created;
}

/** Creates a membership through the sensitive-action gate. */
async function createMembership(
  actor: ApiSession,
  actorPassword: string,
  body: Json,
): Promise<Json> {
  expect((await actor.stepUp(actorPassword)).status(), "step-up before user creation").toBe(200);
  return okJson(await actor.post(Routes.SECURITY_MEMBERSHIPS, body), `create ${body.role}`);
}

/**
 * Run state persisted between attempts. Every step that can be expensive or
 * needs a human records its outcome here so a later `npm run workflow` resumes
 * from that point instead of recreating the chain.
 */
type ResumeState = WorkflowState & {
  runId?: string;
  packetSubmitted?: boolean;
  allocated?: boolean;
  evaluationSubmitted?: boolean;
  policyRelaxed?: boolean;
};

/**
 * Saves the ids, role mailboxes and progress markers this flow produced so the
 * report steps, the Admin verification and a resumed run resolve the same records.
 * @param runId - Run identifier used in this flow's mailboxes
 * @param extra - Progress flags such as `packetSubmitted` or `allocated`
 * @returns The workflow state the report helpers consume
 */
function persistFlowState(
  runId: string,
  extra: Record<string, unknown> = {},
): WorkflowState {
  const saved = readRunState() as unknown as WorkflowState;
  const state = {
    university: saved.university,
    runId,
    ids: flow.ids,
    emails: flow.emails,
    ...extra,
  } as unknown as WorkflowState;
  saveRunState(state as unknown as Record<string, unknown>);
  upsertEnv({
    DVS_ALLOW_WRITES: "true",
    DVS_CHAIRMAN_EMAIL: flow.emails.chairman ?? "",
    DVS_CHAIRMAN_PASSWORD: rolePassword,
    DVS_CHIEF_EMAIL: flow.emails.chief ?? "",
    DVS_CHIEF_PASSWORD: rolePassword,
    DVS_EVALUATOR_EMAIL: flow.emails.evaluator ?? "",
    DVS_EVALUATOR_PASSWORD: rolePassword,
    DVS_SCANNER_EMAIL: flow.emails.scanner_operator ?? "",
    DVS_SCANNER_PASSWORD: rolePassword,
    DVS_USER_MANAGER_EMAIL: flow.emails.user_manager ?? "",
    DVS_USER_MANAGER_PASSWORD: rolePassword,
  });
  return state;
}

/**
 * Allocates this run's ready packet to the Evaluator from the Chief's session.
 * Allocation is gated on the Evaluator having recorded attendance, which the
 * live face step in step 9 establishes.
 * @param state - Ids saved by this flow
 */
async function allocatePacket(state: WorkflowState): Promise<void> {
  const chief = await session("chief");
  const batches = await okJson<Json[]>(
    await chief.get(Routes.ALLOCATION_EXAMINER_BATCHES),
    "examiner batches",
  );
  const batch = batches.find((candidate) => candidate.chief?.id === state.ids.chiefProfile);
  if (!batch) throw new Error("The Chief has no allocation batch for this run.");

  const groups = await okJson(
    await chief.get(RouteBuilders.allocationSubjectGroups(batch.id)),
    "subject groups",
  );
  const group =
    ((groups.groups ?? []) as Json[]).find(
      (candidate) => candidate.group_id === state.ids.group,
    ) ?? ((groups.groups ?? []) as Json[]).find((candidate) => candidate.ready);
  if (!group) throw new Error("No ready packet to allocate for this run.");

  const member =
    ((batch.members ?? []) as Json[]).find(
      (candidate) => candidate.evaluator_id === state.ids.evaluatorProfile,
    ) ?? ((batch.members ?? []) as Json[])[0];
  if (!member) throw new Error("The Evaluator is not a member of the Chief's batch.");

  const allocated = await chief.post(RouteBuilders.allocationAllocateSubjectGroup(batch.id), {
    group_id: group.group_id,
    member_id: member.id,
  });
  if ([200, 201].includes(allocated.status())) return;

  // A resumed run may find the packet already allocated; that is success, not a
  // failure, so confirm the assignment exists before reporting an error.
  const catalog = await okJson(
    await chief.get(RouteBuilders.allocationCatalogWorkflow(true)),
    "allocation catalog",
  );
  const alreadyAssigned = ((catalog.assignments ?? []) as Json[]).some(
    (assignment) =>
      assignment.evaluator_id === state.ids.evaluatorProfile &&
      (assignment.group_id === state.ids.group ||
        assignment.paper_id === state.ids.paper ||
        assignment.group_id === group.group_id),
  );
  if (alreadyAssigned) return;

  throw new Error(
    `Allocation failed (${allocated.status()}): ${(await allocated.text()).slice(0, 400)}`,
  );
}

test.describe("DVS continuous workflow @master @end-to-end", () => {
  test.skip(!tenantUrl, "Run `npm run test:platform` first to provision a university.");
  test.skip(!adminEmail || !adminPassword, "The provisioned Admin credentials are missing from .env.");
  test.skip(!rolePassword, "Set DVS_ROLE_NEW_PASSWORD in .env.");
  test.skip(process.env.DVS_ALLOW_WRITES !== "true", "Set DVS_ALLOW_WRITES=true.");

  // The face steps are human-in-the-loop: by default the run waits until the
  // application confirms the face is verified. Set FACE_ENROLLMENT_TIMEOUT_MS to
  // a positive value only when a bounded wait is wanted.
  const faceTimeoutMs = Number(process.env.FACE_ENROLLMENT_TIMEOUT_MS ?? 0);
  // Unbounded by default. When a face cap is configured, leave room for the
  // provisioning, storage and reporting steps around the human wait.
  test.setTimeout(faceTimeoutMs > 0 ? faceTimeoutMs + 15 * 60_000 : 0);

  test.afterAll(async () => {
    for (const active of sessions.values()) await active.dispose();
  });

  test("runs Admin -> report receipt as one flow", async ({ browser }) => {
    // Resume only when the saved state belongs to the current university. A
    // freshly provisioned tenant has an empty state, so that run starts clean.
    const saved = readRunState() as unknown as ResumeState;
    const sameTenant = saved.university?.tenantUrl === tenantUrl;
    if (sameTenant && saved.ids && Object.keys(saved.ids).length > 0) {
      Object.assign(flow.ids, saved.ids);
      Object.assign(flow.emails, saved.emails ?? {});
      console.log(
        `\nRESUMING "${tenantUrl}" — already done: ${Object.keys(saved.ids).join(", ")}\n`,
      );
    }

    const runId = sameTenant && saved.runId ? saved.runId : Date.now().toString(36).toLowerCase();
    const upper = runId.toUpperCase();
    const mail = (prefix: string) => `${prefix}.${runId}@example.com`;
    const resume = sameTenant ? saved : ({} as ResumeState);

    /** Mutable progress flags; written to the run state after each milestone. */
    const progress = {
      packetSubmitted: Boolean(resume.packetSubmitted),
      allocated: Boolean(resume.allocated),
      evaluationSubmitted: Boolean(resume.evaluationSubmitted),
      policyRelaxed: Boolean(resume.policyRelaxed),
    };

    await test.step("1) Admin builds the academic chain", async () => {
      if (flow.ids.subject) {
        console.log("  resume: academic chain already created");
        return;
      }
      const admin = await session("admin");

      const programme = await okJson(
        await admin.post(Routes.CONFIGURATION_PROGRAMMES, {
          code: `${academic.programme.code}-${upper}`,
          name: `${academic.programme.name} ${upper}`,
        }),
        "create programme",
      );
      flow.ids.programme = programme.id;

      const regulation = await okJson(
        await admin.post(Routes.CONFIGURATION_REGULATIONS, {
          code: `${academic.regulation.code}-${upper}`,
          title: `${academic.regulation.title} ${upper}`,
          programme_ids: [flow.ids.programme],
        }),
        "create regulation",
      );
      flow.ids.regulation = regulation.id;

      const academicYear = await okJson(
        await admin.post(Routes.CONFIGURATION_ACADEMIC_YEARS, {
          regulation_id: flow.ids.regulation,
          label: academic.academicYear.label,
        }),
        "create academic year",
      );
      flow.ids.academicYear = academicYear.id;

      const examSession = await okJson(
        await admin.post(Routes.CONFIGURATION_SESSIONS, {
          programme_id: flow.ids.programme,
          academic_year_id: flow.ids.academicYear,
          name: `${academic.examSession.name} ${upper}`,
        }),
        "create session",
      );
      flow.ids.session = examSession.id;

      const course = await okJson(
        await admin.post(Routes.CONFIGURATION_COURSES, {
          programme_id: flow.ids.programme,
          regulation_id: flow.ids.regulation,
          code: `${academic.course.code}-${upper}`,
          name: `${academic.course.name} ${upper}`,
        }),
        "create course",
      );
      flow.ids.course = course.id;

      const subject = await okJson(
        await admin.post(Routes.CONFIGURATION_SUBJECTS, {
          programme_id: flow.ids.programme,
          regulation_id: flow.ids.regulation,
          academic_year_id: flow.ids.academicYear,
          course_id: flow.ids.course,
          semester: academic.subject.semester,
          session_ids: [flow.ids.session],
          code: `${academic.subject.code}-${upper}`,
          name: `${academic.subject.name} ${upper}`,
        }),
        "create subject",
      );
      flow.ids.subject = subject.id;

      const catalog = await okJson(await admin.get(Routes.CONFIGURATION_CATALOG), "configuration catalog");
      expect(catalog.subjects.some((row: Json) => row.id === flow.ids.subject)).toBe(true);
      persistFlowState(runId);
    });

    await test.step("2) Admin configures the paper, documents and marking scheme", async () => {
      if (flow.ids.paper && flow.ids.scheme) {
        console.log("  resume: paper and marking scheme already created");
        return;
      }
      const admin = await session("admin");
      const cfg = paperConfig.paper;

      const paper = await okJson(
        await admin.post(Routes.CONFIGURATION_PAPERS, {
          paper_type: cfg.paperType,
          session_id: flow.ids.session,
          subject_id: flow.ids.subject,
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
      flow.ids.paper = paper.id;

      const sections = await okJson(
        await admin.post(RouteBuilders.configurationPaperSetupSections(flow.ids.paper), {
          version: paper.version,
          sections: paperConfig.sections,
        }),
        "setup sections",
      );
      expect(sections.readiness.ready, "paper readiness").toBe(true);

      const filesDir = path.join(testdataDir, "files");
      await okJson(
        await admin.uploadPdf(
          RouteBuilders.configurationPaperQuestionPaper(flow.ids.paper),
          path.join(filesDir, "question-paper.pdf"),
        ),
        "upload question paper",
      );
      await okJson(
        await admin.uploadPdf(
          RouteBuilders.configurationPaperEvaluationScheme(flow.ids.paper),
          path.join(filesDir, "evaluation-scheme.pdf"),
        ),
        "upload evaluation scheme",
      );

      const content = await okJson(
        await admin.get(RouteBuilders.configurationPaperQuestionContent(flow.ids.paper)),
        "question content",
      );
      const submitted = await okJson(
        await admin.post(RouteBuilders.configurationPaperSubmit(flow.ids.paper), {
          version: content.paper_version,
        }),
        "submit paper",
      );
      expect(submitted.status).not.toBe("draft");

      const scheme = await okJson(
        await admin.post(Routes.RUBRICS_SCHEMES, {
          paper_id: flow.ids.paper,
          title: `DVS Scheme ${upper}`,
          evaluation_guidelines: "Award marks per the question guide.",
          examiner_instructions: "Evaluate every page of the script.",
        }),
        "create scheme",
      );
      const frozen = await okJson(
        await admin.post(RouteBuilders.rubricsSchemeTransition(scheme.id), {
          target: "review",
          version: scheme.version,
        }),
        "freeze scheme",
      );
      expect(frozen.status).toBe("frozen");
      flow.ids.scheme = scheme.id;
      persistFlowState(runId);
    });

    await test.step("3) Admin creates, readiness-checks and activates the evaluation centre", async () => {
      if (flow.ids.centre) {
        console.log("  resume: evaluation centre already active");
        return;
      }
      const admin = await session("admin");
      const centre = academic.centre;

      const created = await okJson(
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
      flow.ids.centre = created.id;

      const ready = await okJson(
        await admin.post(RouteBuilders.phase4CentreReadiness(flow.ids.centre), {
          scanner_ready: true,
          workstation_ready: true,
          network_ready: true,
          power_ready: true,
          secure_lan_ready: true,
          operators_ready: true,
          notes: "Synthetic readiness check",
        }),
        "centre readiness",
      );
      expect(ready.decision, "centre readiness decision").toBe("go");

      // Readiness does not return the record version, so the catalogue is the
      // only grounded source for the version the activation must carry.
      const centreCatalog = await okJson(
        await admin.get(RouteBuilders.phase4Catalog("centres")),
        "centres catalog",
      );
      const centreRow = ((centreCatalog.centres ?? []) as Json[]).find(
        (row) => row.id === flow.ids.centre,
      );
      if (!centreRow) throw new Error("The created centre is missing from the centres catalog.");

      const activated = await okJson(
        await admin.post(RouteBuilders.phase4CentreAction(flow.ids.centre), {
          action: "activate",
          version: Number(centreRow.version ?? 1),
          target: "active",
        }),
        "activate centre",
      );
      expect(activated.status).toBe("active");
      persistFlowState(runId);
    });

    await test.step("4) Admin provisions the User Manager and the Chairman", async () => {
      if (flow.emails.user_manager && flow.emails.chairman) {
        console.log("  resume: User Manager and Chairman already provisioned");
        return;
      }
      const admin = await session("admin");
      const userManager = provisioning.membershipRoles.find((role: Json) => role.role === "user_manager");
      const chairman = provisioning.membershipRoles.find((role: Json) => role.role === "chairman");

      const umEmail = mail(userManager.emailPrefix);
      const umHandover = await createMembership(admin, adminPassword, {
        first_name: userManager.firstName,
        last_name: userManager.lastName,
        email: umEmail,
        role: "user_manager",
        permissions: userManager.permissions,
        enabled_modules: userManager.enabledModules,
        operational_centre_id: flow.ids.centre,
        programme_id: null,
        custom_fields: {},
      });
      flow.emails.user_manager = umEmail;
      sessions.set(
        "user_manager",
        await completeFirstLogin(umEmail, umHandover.temporary_password, rolePassword),
      );

      const chairmanEmail = mail(chairman.emailPrefix);
      const chairmanHandover = await createMembership(admin, adminPassword, {
        first_name: chairman.firstName,
        last_name: chairman.lastName,
        email: chairmanEmail,
        role: "chairman",
        permissions: chairman.permissions,
        enabled_modules: chairman.enabledModules,
        operational_centre_id: flow.ids.centre,
        programme_id: flow.ids.programme,
        custom_fields: {},
      });
      flow.emails.chairman = chairmanEmail;
      sessions.set(
        "chairman",
        await completeFirstLogin(chairmanEmail, chairmanHandover.temporary_password, rolePassword),
      );

      // Persist immediately: a later live step may wait on a human, and the
      // provisioned accounts must already be available to the role suites.
      persistFlowState(runId);
    });

    await test.step("5) Chairman registers a Chief Examiner and nominates the Chief", async () => {
      if (flow.ids.chiefProfile) {
        console.log("  resume: Chief Examiner already registered and nominated");
        return;
      }
      const chairman = await session("chairman");
      const profile = provisioning.evaluatorProfiles.find((item: Json) => item.kind === "chief");
      const chiefEmail = mail(profile.emailPrefix);

      const registered = await okJson(
        await chairman.post(Routes.EVALUATOR_MANAGEMENT, {
          display_name: profile.displayName,
          email: chiefEmail,
          institution_name: profile.institutionName,
          department: profile.department,
          years_experience: profile.yearsExperience,
          mobile: "",
          employee_id: `${profile.employeeId}-${upper}`,
          designation: profile.designation,
          qualification: profile.qualification,
          employment_type: profile.employmentType.toLowerCase(),
          grade: "chief",
          subject_ids: [flow.ids.subject],
        }),
        "register chief",
      );
      flow.ids.chiefProfile = registered.id;
      flow.emails.chief = chiefEmail;

      const nomination = await okJson(
        await chairman.post(Routes.CHAIRMAN_NOMINATIONS, {
          subject_id: flow.ids.subject,
          evaluator_id: registered.id,
        }),
        "nominate chief",
      );
      flow.ids.nomination = nomination.id;
      sessions.set(
        "chief",
        await completeFirstLogin(chiefEmail, nomination.credentials.temporary_password, rolePassword),
      );
      persistFlowState(runId);
    });

    await test.step("6) Chief accepts the nomination and registers the Evaluator", async () => {
      if (flow.ids.evaluatorProfile) {
        console.log("  resume: Evaluator already registered and nominated");
        return;
      }
      const chief = await session("chief");
      const profile = provisioning.evaluatorProfiles.find((item: Json) => item.kind === "evaluator");
      const evaluatorEmail = mail(profile.emailPrefix);

      await okJson(
        await chief.post(RouteBuilders.chairmanNominationAccept(flow.ids.nomination)),
        "accept nomination",
      );

      const registered = await okJson(
        await chief.post(Routes.EVALUATOR_MANAGEMENT, {
          display_name: profile.displayName,
          email: evaluatorEmail,
          institution_name: profile.institutionName,
          department: profile.department,
          years_experience: profile.yearsExperience,
          mobile: "",
          employee_id: `${profile.employeeId}-${upper}`,
          designation: profile.designation,
          qualification: profile.qualification,
          employment_type: profile.employmentType.toLowerCase(),
          subject_ids: [flow.ids.subject],
        }),
        "register evaluator",
      );
      flow.ids.evaluatorProfile = registered.id;
      flow.emails.evaluator = evaluatorEmail;

      const nominated = await okJson(
        await chief.post(Routes.CHIEF_TEAM_NOMINATIONS, {
          evaluator_id: registered.id,
          subject_id: flow.ids.subject,
        }),
        "nominate evaluator",
      );
      sessions.set(
        "evaluator",
        await completeFirstLogin(
          evaluatorEmail,
          nominated.credentials.temporary_password,
          rolePassword,
        ),
      );
      persistFlowState(runId);
    });

    await test.step("7) User Manager provisions the Scanner Operator", async () => {
      if (flow.emails.scanner_operator) {
        console.log("  resume: Scanner Operator already provisioned");
        return;
      }
      const userManager = await session("user_manager");
      const profile = provisioning.membershipRoles.find(
        (role: Json) => role.role === "scanner_operator",
      );
      const scannerEmail = mail(profile.emailPrefix);

      const handover = await createMembership(userManager, rolePassword, {
        first_name: profile.firstName,
        last_name: profile.lastName,
        email: scannerEmail,
        role: "scanner_operator",
        permissions: profile.permissions,
        enabled_modules: profile.enabledModules,
        operational_centre_id: flow.ids.centre,
        programme_id: null,
        custom_fields: {},
      });
      flow.emails.scanner_operator = scannerEmail;
      sessions.set(
        "scanner_operator",
        await completeFirstLogin(scannerEmail, handover.temporary_password, rolePassword),
      );
      persistFlowState(runId);
    });

    await test.step("8) Scanner Operator digitizes a script and submits the packet", async () => {
      if (progress.packetSubmitted) {
        console.log("  resume: packet already submitted");
        return;
      }
      const scanner = await session("scanner_operator");
      const pages = paperConfig.paper.pagesPerScript as number;

      // Reuse this run's existing packet when it is already stored or submitted,
      // so repeated attempts do not pile up scripts on the same paper.
      if (flow.ids.script && flow.ids.group) {
        const body = await okJson(
          await scanner.get(RouteBuilders.receivingSubjectScripts(flow.ids.paper)),
          "script status",
        );
        const group = ((body.groups ?? []) as Json[]).find(
          (candidate) => candidate.group_id === flow.ids.group,
        );
        const entry = ((group?.scripts ?? []) as Json[]).find(
          (candidate) => candidate.script_id === flow.ids.script,
        );
        if (group?.submitted || String(entry?.state ?? "") === "stored") {
          if (!group?.submitted) {
            await okJson(
              await scanner.post(RouteBuilders.receivingSubjectGroupSubmit(flow.ids.group)),
              "submit packet",
            );
          }
          console.log("  resume: reused the stored packet");
          progress.packetSubmitted = true;
          persistFlowState(runId, { ...progress });
          return;
        }
      }

      const script = await okJson(
        await scanner.post(Routes.RECEIVING_SUBJECT_SCRIPTS, {
          paper_id: flow.ids.paper,
          idempotency_key: crypto.randomUUID(),
        }),
        "create script",
      );
      flow.ids.script = script.script_id;
      flow.ids.group = script.group_id;
      persistFlowState(runId, { ...progress });

      const sha256 = createHash("sha256").update(PAGE_PNG).digest("hex");
      for (let page = 1; page <= pages; page += 1) {
        const intent = await okJson(
          await scanner.post(Routes.REPOSITORY_MANUAL_SCAN_UPLOAD, {
            script_id: script.script_id,
            page_number: page,
            content_type: "image/png",
            maximum_bytes: PAGE_PNG.length,
          }),
          `upload intent page ${page}`,
        );
        const put = await scanner.api.put(intent.upload_url, {
          data: PAGE_PNG,
          headers: intent.headers,
        });
        expect(put.status(), `page ${page} upload`).toBe(201);
        await okJson(
          await scanner.post(RouteBuilders.repositoryUploadFinalize(intent.id), {
            version: intent.version,
            sha256,
            byte_size: PAGE_PNG.length,
          }),
          `finalize page ${page}`,
        );
      }

      await okJson(
        await scanner.post(RouteBuilders.repositoryScriptCompleteScan(script.script_id), {
          version: script.version,
          page_count: pages,
        }),
        "complete scan",
      );

      // Poll this run's own script, not the first group in the catalog: the
      // tenant may already hold older packets from earlier attempts.
      const thisScriptState = async (): Promise<string> => {
        const body = await okJson(
          await scanner.get(RouteBuilders.receivingSubjectScripts(flow.ids.paper)),
          "script status",
        );
        const group = ((body.groups ?? []) as Json[]).find(
          (candidate) => candidate.group_id === script.group_id,
        );
        const entry = ((group?.scripts ?? []) as Json[]).find(
          (candidate) => candidate.script_id === script.script_id,
        );
        return String(entry?.state ?? "");
      };

      await expect
        .poll(thisScriptState, { timeout: 120_000, intervals: [2_000] })
        .toBe("stored");

      // The group's stored/total counters are not part of this response, so the
      // script-level `stored` state above is the readiness gate.
      const submitted = await okJson(
        await scanner.post(RouteBuilders.receivingSubjectGroupSubmit(script.group_id)),
        "submit packet",
      );
      expect(submitted.closed, "packet closed").toBe(true);
      progress.packetSubmitted = true;
      persistFlowState(runId, { ...progress });
    });

    await test.step("8.5) Admin relaxes the evaluation security policy", async () => {
      // Runs on every attempt: it is quick and idempotent, and guarantees the
      // evaluator never inherits a strict policy from an earlier run.
      logProgress("opening Access governance to relax the evaluation security policy");
      await relaxEvaluationPolicy(browser);
      progress.policyRelaxed = true;
      persistFlowState(runId, { ...progress });
      console.log("  evaluation security controls unchecked");
    });

    await test.step("9) Evaluator enrolls, passes the face check, marks and submits", async () => {
      const evaluatorEmail = flow.emails.evaluator;
      if (!evaluatorEmail) throw new Error("The Evaluator was not provisioned.");

      resetFaceFlag();
      logProgress("opening the evaluator workspace");
      const { page, context } = await openEvaluatorWorkspace(
        browser,
        evaluatorEmail,
        rolePassword,
        faceTimeoutMs,
      );
      logProgress("evaluator workspace ready");

      try {
        const state = persistFlowState(runId, { ...progress });

        if (!progress.allocated) {
          await test.step("9.a) Chief allocates the ready packet to the Evaluator", async () => {
            await allocatePacket(state);
            progress.allocated = true;
            persistFlowState(runId, { ...progress });
          });
        } else {
          console.log("  resume: packet already allocated");
        }

        if (!progress.evaluationSubmitted) {
          await test.step("9.b) Evaluator passes the face check and marks the script", async () => {
            logProgress("reloading the evaluation desk");
            await page.reload();
            logProgress("desk reloaded; starting the secure check");
            await beginSecureMarking(page, faceTimeoutMs);
            await markAndSubmit(page);
            progress.evaluationSubmitted = true;
            persistFlowState(runId, { ...progress });
          });
        } else {
          console.log("  resume: evaluation already submitted");
        }

        await test.step("9.c) report, moderation, Chairman forwarding and Admin receipt", async () => {
          logProgress("running the report chain");
          await completeAfterEvaluation(page, state);
          logProgress("report chain finished");
        });
      } finally {
        await context.close();
      }
    });

    await test.step("10) Admin can see the finished evaluation report", async () => {
      const state = persistFlowState(runId, { ...progress });
      const admin = await ApiSession.login(adminEmail, adminPassword);
      try {
        const workflow = await okJson(
          await admin.get(Routes.EVALUATION_WORKFLOW_CATALOG),
          "evaluation workflow catalog",
        );
        const reports = (workflow.reports ?? []) as Json[];
        const reachedAdmin = reports.find(
          (report) =>
            report.kind === "moderation" &&
            (report.destination === "admin" || Boolean(report.forwarded_at)),
        );
        expect(reachedAdmin, "the moderation report reached Admin").toBeTruthy();
        const detail = await okJson(
          await admin.get(RouteBuilders.evaluationWorkflowReport(reachedAdmin!.id)),
          "report detail",
        );
        const saved = saveReportArtifact(
          String(reachedAdmin!.id),
          reachedAdmin!,
          detail,
          tenantUrl,
        );
        const workbook = saveReportDocs(
          String(reachedAdmin!.id),
          reachedAdmin!,
          detail,
          tenantUrl,
          state.university?.name ?? process.env.DVS_TENANT_NAME ?? "",
          runId,
        );
        flow.ids.report = String(reachedAdmin!.id);
        flow.ids.reportHtml = saved.htmlPath;
        flow.ids.reportDoc = workbook.xlsxPath;
        flow.ids.reportCsv = workbook.csvPath;
        console.log(`✅ Admin received report ${reachedAdmin!.id}`);
        console.log(`  report stored: ${saved.htmlPath}`);
        console.log(`  Excel stored: ${workbook.xlsxPath} (${workbook.rowCount} scripts)`);
        console.log(`  CSV stored:   ${workbook.csvPath}`);
      } finally {
        await admin.dispose();
      }
      expect(state.university?.tenantUrl).toBe(tenantUrl);
    });

    await test.step("11) end of flow checklist and result link", async () => {
      const state = persistFlowState(runId, { ...progress });
      const reportId = flow.ids.report;
      if (!reportId) throw new Error("The Admin report id is missing.");

      const roles = [
        { label: "User Manager", email: flow.emails.user_manager ?? "" },
        { label: "Chairman", email: flow.emails.chairman ?? "" },
        { label: "Chief Examiner", email: flow.emails.chief ?? "" },
        { label: "Evaluator", email: flow.emails.evaluator ?? "" },
        { label: "Scanner Operator", email: flow.emails.scanner_operator ?? "" },
      ];

      // One green tick per business milestone, in the order a real customer
      // journey produces them, ending on the Admin receiving the report.
      const summary = saveWorkflowSummary(reportId, {
        runId,
        tenantUrl,
        spreadsheetPath: flow.ids.reportDoc,
        csvPath: flow.ids.reportCsv,
        entries: [
          {
            title: "University created",
            actor: "Platform Admin",
            details: [
              { label: "University name", value: state.university?.name ?? "" },
              { label: "Tenant URL", value: tenantUrl },
            ],
          },
          {
            title: "University Admin created and first login completed",
            actor: "University Admin",
            details: [
              { label: "Admin mail", value: adminEmail },
              { label: "Password", value: adminPassword },
            ],
          },
          {
            title: "Academic chain configured (programme → subject)",
            actor: "University Admin",
          },
          {
            title: "Paper, question paper and marking scheme ready",
            actor: "University Admin",
          },
          {
            title: "Evaluation centre readiness-checked and active",
            actor: "University Admin",
          },
          {
            title: "User Manager and Chairman added",
            actor: "University Admin",
            details: [
              { label: "User Manager", value: flow.emails.user_manager ?? "" },
              { label: "Chairman", value: flow.emails.chairman ?? "" },
              { label: "Password", value: rolePassword },
            ],
          },
          {
            title: "Chief Examiner registered and nominated",
            actor: "Chairman",
            details: [
              { label: "Chief Examiner", value: flow.emails.chief ?? "" },
              { label: "Password", value: rolePassword },
            ],
          },
          {
            title: "Evaluator registered and nominated",
            actor: "Chief Examiner",
            details: [
              { label: "Evaluator", value: flow.emails.evaluator ?? "" },
              { label: "Password", value: rolePassword },
            ],
          },
          {
            title: "Scanner Operator added",
            actor: "User Manager",
            details: [
              { label: "Scanner Operator", value: flow.emails.scanner_operator ?? "" },
              { label: "Password", value: rolePassword },
            ],
          },
          { title: "Scripts digitized and packet submitted", actor: "Scanner Operator" },
          { title: "Packet allocated and evaluation marked", actor: "Evaluator" },
          { title: "Moderation approved", actor: "Chief Examiner" },
          { title: "Report forwarded to the Admin", actor: "Chairman" },
          {
            title: "Admin received the result report",
            actor: "University Admin",
            details: [
              { label: "Report", value: path.basename(flow.ids.reportHtml) },
              { label: "Excel", value: path.basename(flow.ids.reportDoc) },
            ],
          },
        ],
      });

      const resultPath = flow.ids.reportHtml;
      const tick = "✅";
      const lines = [
        `${tick} University created`,
        `     University name: ${state.university?.name ?? ""}`,
        `     University admin mail: ${adminEmail}`,
        `     Password: ${adminPassword}`,
      ];
      for (const role of roles) {
        lines.push(
          `${tick} ${role.label} created`,
          `     Mail: ${role.email}`,
          `     Password: ${rolePassword}`,
        );
      }
      lines.push(
        `${tick} Academic chain, paper, scheme and centre ready`,
        `${tick} Scripts digitized and packet submitted`,
        `${tick} Evaluation marked and submitted`,
        `${tick} Moderation approved and report forwarded`,
        `${tick} Admin received result report`,
      );

      console.log(`\n${"=".repeat(64)}\nWORKFLOW COMPLETE — END OF FLOW\n${"=".repeat(64)}`);
      console.log(lines.join("\n"));
      console.log("-".repeat(64));
      console.log(`Click here to view result: ${resultPath}`);
      console.log(`Excel report (docs): ${flow.ids.reportDoc}`);
      console.log(`CSV report (docs):   ${flow.ids.reportCsv}`);
      console.log(`Summary page: ${summary.summaryPath}`);
      console.log(`Latest summary: ${summary.latestPath}`);
      console.log(`${"=".repeat(64)}\n`);

      openWorkflowSummary(summary.latestPath);
    });
  });
});
