import "dotenv/config";
import { expect, type Page } from "@playwright/test";
import { ApiSession, okJson, type Json } from "./apiClient";
import { variedMarks } from "./marks";
import { RouteBuilders, Routes } from "../api/endpoints/routes";

export type WorkflowState = {
  emails?: Record<string, string>;
  ids: Record<string, string>;
  university?: {
    tenantId?: string;
    name?: string;
    code?: string;
    subdomain?: string;
    tenantUrl?: string;
    adminEmail?: string;
  };
};

/**
 * Loads this run's marks keyed by question number. A per-university seed makes
 * each script's marks different instead of reusing the full-mark reference.
 * @returns Map of question number to the mark row
 */
function marksByNumber(): Map<number, Json> {
  return new Map<number, Json>(variedMarks().map((mark) => [Number(mark.questionNumber), mark]));
}

/**
 * Resolves one workflow role login. Provisioned accounts own this run's records,
 * so they take precedence; supplied `.env` credentials are the fallback.
 * @param state - Ids and emails saved by the provisioning workflow
 * @param role - Run-state role key
 * @param envPrefix - Environment variable prefix, e.g. `DVS_CHIEF`
 * @returns Email and password for the role
 */
function roleCredentials(state: WorkflowState, role: string, envPrefix: string) {
  const provisionedEmail = state.emails?.[role] ?? "";
  if (provisionedEmail) {
    return {
      email: provisionedEmail,
      password: process.env.DVS_ROLE_NEW_PASSWORD || process.env[`${envPrefix}_PASSWORD`] || "",
    };
  }
  return {
    email: process.env[`${envPrefix}_EMAIL`]?.trim() || "",
    password: process.env[`${envPrefix}_PASSWORD`] || "",
  };
}

/**
 * Calls an API route through the Evaluator's authenticated browser session.
 * @param page - Authenticated browser page
 * @param method - HTTP method
 * @param apiPath - Route from `Routes` or `RouteBuilders`
 * @param body - Optional JSON payload
 * @param extraHeaders - Additional headers such as the assignment lock
 * @returns Status and parsed body
 */
async function browserRequest(
  page: Page,
  method: "GET" | "POST" | "PUT",
  apiPath: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: Json }> {
  const base = process.env.WEB_APP_URL;
  if (!base) throw new Error("Set WEB_APP_URL.");

  const cookies = await page.context().cookies();
  const csrf = cookies.find((cookie) => cookie.name === "csrftoken")?.value;
  const tenant = await page
    .evaluate(() => localStorage.getItem("admiezo-active-tenant-id"))
    .catch(() => null);
  const secureSession = await page
    .evaluate(() => sessionStorage.getItem("admiezo-secure-evaluation-id"))
    .catch(() => null);

  const headers: Record<string, string> = {
    Accept: "application/json",
    Origin: base.replace(/\/+$/, ""),
    Referer: base,
    ...extraHeaders,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (csrf) headers["X-CSRFToken"] = csrf;
  if (tenant) headers["X-Tenant-Id"] = tenant;
  if (secureSession) headers["X-Secure-Evaluation-Session"] = secureSession;

  const response = await page.request.fetch(new URL(apiPath, base).toString(), {
    method,
    headers,
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Json = {};
  try {
    parsed = text ? (JSON.parse(text) as Json) : {};
  } catch {
    parsed = { detail: text.slice(0, 300) };
  }
  return { status: response.status(), body: parsed };
}

function must(status: number, expected: number[], label: string, body: Json): Json {
  if (!expected.includes(status)) {
    throw new Error(
      `${label}: expected ${expected.join("/")}, got ${status} - ${JSON.stringify(body).slice(0, 400)}`,
    );
  }
  return body;
}

/**
 * Allocates the submitted packet to the nominated Evaluator as the Chief.
 * @param state - Ids saved by the provisioning workflow
 */
async function allocateToEvaluator(state: WorkflowState): Promise<void> {
  const { email, password } = roleCredentials(state, "chief", "DVS_CHIEF");
  if (!email || !password) throw new Error("Chief credentials are missing for allocation.");

  const chief = await ApiSession.login(email, password);
  try {
    const batches = await okJson<Json[]>(
      await chief.get(Routes.ALLOCATION_EXAMINER_BATCHES),
      "examiner batches",
    );
    const batch =
      batches.find((candidate) => candidate.chief?.id === state.ids.chiefProfile) ??
      batches.find((candidate) =>
        (candidate.subjects ?? []).some((subject: Json) => subject.id === state.ids.subject),
      );
    if (!batch) throw new Error("Chief has no allocation batch for this run.");

    const groupsBody = await okJson<Json>(
      await chief.get(RouteBuilders.allocationSubjectGroups(batch.id)),
      "subject groups",
    );
    const groups = (groupsBody.groups ?? []) as Json[];
    const group =
      groups.find((candidate) => candidate.group_id === state.ids.group) ??
      groups.find((candidate) => !candidate.submitted) ??
      groups[0];
    if (!group) throw new Error("No subject group available for allocation.");

    const member =
      (batch.members ?? []).find(
        (candidate: Json) => candidate.evaluator_id === state.ids.evaluatorProfile,
      ) ?? (batch.members ?? [])[0];
    if (!member) throw new Error("No evaluator member in the chief batch.");

    const response = await chief.post(RouteBuilders.allocationAllocateSubjectGroup(batch.id), {
      group_id: group.group_id,
      member_id: member.id,
    });
    must(response.status(), [200, 201, 400, 409], "allocate subject group", {});
  } finally {
    await chief.dispose();
  }
}

/**
 * Locks, opens, marks and submits the Evaluator assignment.
 * @param page - Authenticated Evaluator page with the secure session
 * @param state - Ids saved by the provisioning workflow
 */
async function evaluateAndSubmit(page: Page, state: WorkflowState): Promise<void> {
  const catalog = await browserRequest(
    page,
    "GET",
    RouteBuilders.allocationCatalogWorkflow(true),
  );
  must(catalog.status, [200], "evaluator assignment catalog", catalog.body);
  const assignments = (catalog.body.assignments ?? []) as Json[];
  const assignment =
    assignments.find(
      (candidate) => candidate.paper_id === state.ids.paper && candidate.status !== "submitted",
    ) ??
    assignments.find((candidate) => candidate.status !== "submitted") ??
    assignments.find((candidate) => candidate.id === state.ids.assignment);
  if (!assignment) throw new Error("No evaluator assignment found after allocation.");

  let version = Number(assignment.version ?? 1);
  const lock = await browserRequest(
    page,
    "POST",
    RouteBuilders.assignmentLock(assignment.id),
    { version },
  );
  const lockToken = String(lock.body.token ?? "");
  must(lock.status, [200, 409], "assignment lock", lock.body);

  if (assignment.status !== "submitted" && assignment.status !== "in_progress") {
    const started = await browserRequest(
      page,
      "POST",
      RouteBuilders.allocationAssignmentAction(assignment.id),
      { version, action: "start" },
    );
    if (started.status === 200) version = Number(started.body.version ?? version + 1);
  }

  const opened = await browserRequest(
    page,
    "POST",
    RouteBuilders.markingOpen(assignment.id),
  );
  const openedBody = must(opened.status, [200], "open evaluation", opened.body);
  const evaluationId = String(openedBody.evaluation_id ?? openedBody.id ?? "");
  if (!evaluationId) throw new Error("Open evaluation did not return an evaluation id.");

  const workspace = await browserRequest(
    page,
    "GET",
    RouteBuilders.markingWorkspace(assignment.id),
  );
  const ws = must(workspace.status, [200], "marking workspace", workspace.body);
  const questions = (ws.questions ?? []) as Json[];
  if (!questions.length) throw new Error("Workspace returned no questions.");

  let evaluationVersion = Number(ws.evaluation?.version ?? 1);
  const expected = marksByNumber();
  const lockHeaders: Record<string, string> = lockToken
    ? { "X-Assignment-Lock": lockToken }
    : {};

  for (const question of questions) {
    const definition = expected.get(Number(question.number));
    const saved = await browserRequest(
      page,
      "POST",
      RouteBuilders.markingMarks(evaluationId),
      {
        version: evaluationVersion,
        question_id: question.id,
        marks: Number(definition?.awardedMarks ?? 0),
        outcome: definition?.outcome ?? (question.required ? "evaluated" : "unanswered"),
        adjustment: "none",
        requires_attention: false,
        examiner_confirmed: true,
        rubric_criterion_id: null,
      },
      lockHeaders,
    );
    if (saved.status === 200) {
      evaluationVersion = Number(saved.body.version ?? evaluationVersion + 1);
    } else {
      throw new Error(
        `Marking Q${question.number} failed (${saved.status}): ${JSON.stringify(saved.body).slice(0, 300)}`,
      );
    }
  }

  const timerEnds = ws.evaluation?.timer_ends_at ? Date.parse(ws.evaluation.timer_ends_at) : NaN;
  if (Number.isFinite(timerEnds) && timerEnds > Date.now()) {
    await expect
      .poll(() => Date.now() >= timerEnds, {
        timeout: timerEnds - Date.now() + 30_000,
        intervals: [2_000],
      })
      .toBe(true);
  }

  const fresh = await browserRequest(
    page,
    "GET",
    RouteBuilders.markingWorkspace(assignment.id),
  );
  const submitted = await browserRequest(
    page,
    "POST",
    RouteBuilders.workflowEvaluationSubmit(evaluationId),
    {
      evaluation_version: Number(fresh.body.evaluation?.version ?? evaluationVersion),
      workflow_version: Number(fresh.body.workflow?.version ?? 1),
      bosc_checks: fresh.body.bosc_checks ?? ws.bosc_checks ?? [],
    },
    lockHeaders,
  );
  must(submitted.status, [200], "evaluation submit", submitted.body);
}

function packetFor(state: WorkflowState, catalog: Json): Json | undefined {
  const packets = (catalog.packets ?? []) as Json[];
  return (
    packets.find(
      (packet) =>
        packet.evaluator_id === state.ids.evaluatorProfile &&
        (packet.packet_id === state.ids.group || packet.group_id === state.ids.group),
    ) ??
    packets.find(
      (packet) =>
        packet.evaluator_id === state.ids.evaluatorProfile && packet.total > packet.submitted,
    ) ??
    packets.find((packet) => packet.evaluator_id === state.ids.evaluatorProfile)
  );
}

/**
 * Sends the Evaluator completion report to the Chief.
 * @param page - Authenticated Evaluator page
 * @param state - Ids saved by the provisioning workflow
 */
async function sendEvaluatorReport(page: Page, state: WorkflowState): Promise<void> {
  const catalog = await browserRequest(page, "GET", Routes.EVALUATION_WORKFLOW_CATALOG);
  const body = must(catalog.status, [200], "evaluation workflow catalog", catalog.body);
  const packet = packetFor(state, body);
  if (!packet) throw new Error("No evaluator packet found for report delivery.");

  const existing = ((body.reports ?? []) as Json[]).find(
    (report) =>
      report.kind === "completion" &&
      report.evaluator_id === packet.evaluator_id &&
      report.group_id === packet.group_id,
  );
  if (existing) return;

  const created = await browserRequest(page, "POST", Routes.EVALUATION_WORKFLOW_REPORTS, {
    packet_id: packet.packet_id ?? null,
    group_id: packet.packet_id ? null : packet.group_id,
    evaluator_id: packet.evaluator_id,
    kind: "completion",
  });
  must(created.status, [200, 201], "evaluator completion report", created.body);
}

/**
 * Marks every pending moderation sample as the Chief. The operation cannot be
 * decided until each sampled script has a completed review.
 * @param chief - Authenticated Chief session
 * @param operationId - Moderation operation id
 */
async function reviewModerationSamples(chief: ApiSession, operationId: string): Promise<void> {
  const samplesBody = await okJson<Json>(
    await chief.get(RouteBuilders.phase4ModerationSamples(operationId)),
    "moderation samples",
  );
  const expected = marksByNumber();

  for (const sample of (samplesBody.samples ?? []) as Json[]) {
    if (sample.status === "completed") continue;

    const viewer = await okJson<Json>(
      await chief.get(
        RouteBuilders.phase4ModerationSampleViewer(operationId, String(sample.id)),
      ),
      "moderation sample",
    );
    const marks = ((viewer.questions ?? []) as Json[]).map((question) => {
      const definition = expected.get(Number(question.number));
      return {
        question_id: question.id,
        marks: Number(definition?.awardedMarks ?? 0),
        outcome: definition?.outcome ?? "unanswered",
        comment: "",
      };
    });
    const reviewed = await chief.put(
      RouteBuilders.phase4ModerationSampleReview(operationId, String(sample.id)),
      { version: Number(viewer.sample_version ?? sample.version ?? 1), complete: true, marks },
    );
    must(reviewed.status(), [200], "moderation sample review", {});
  }
}

/**
 * Selects, reviews, approves moderation and sends the moderation report to the Chairman.
 * @param state - Ids saved by the provisioning workflow
 */
async function chiefModerateAndReport(state: WorkflowState): Promise<void> {
  const { email, password } = roleCredentials(state, "chief", "DVS_CHIEF");
  const chief = await ApiSession.login(email, password);
  try {
    const assessment = await okJson<Json>(
      await chief.get(Routes.PHASE4_ASSESSMENT_CATALOG),
      "assessment catalog",
    );
    const evaluated = (assessment.evaluated_scripts ?? []) as Json[];
    const batch =
      evaluated.find(
        (candidate) =>
          candidate.paper_id === state.ids.paper &&
          candidate.evaluator_id === state.ids.evaluatorProfile,
      ) ?? evaluated.find((candidate) => candidate.paper_id === state.ids.paper);

    // An approved batch leaves `evaluated_scripts`, so the operation is also
    // matched by the run-suffixed paper code (e.g. DVS-AUTO-KAN001-MWM37RY6).
    const runId = String((state as unknown as { runId?: string }).runId ?? "").toUpperCase();
    const operationFor = (catalog: Json): Json | null =>
      ((catalog.moderation_operations ?? []) as Json[]).find(
        (candidate) =>
          (batch &&
            (candidate.batch_uuid === batch.id || candidate.batch_id === batch.batch_id)) ||
          (runId.length > 0 && String(candidate.paper_id ?? "").endsWith(runId)),
      ) ?? null;

    let operation = operationFor(assessment);
    if (!operation) {
      if (!batch) throw new Error("No evaluated batch for this paper.");
      const detail = await okJson<Json>(
        await chief.get(RouteBuilders.phase4AssessmentBatch(String(batch.id))),
        "evaluated batch",
      );
      const recordIds = ((detail.scripts ?? []) as Json[]).map((script) => String(script.id));
      if (!recordIds.length) throw new Error("The evaluated batch has no scripts to moderate.");

      const selected = await chief.post(
        RouteBuilders.phase4ModerationSelection(String(batch.id)),
        { record_ids: recordIds },
      );
      must(selected.status(), [200, 201], "moderation selection", {});

      const created = await okJson<Json>(
        await chief.get(Routes.PHASE4_ASSESSMENT_CATALOG),
        "assessment catalog refresh",
      );
      operation = operationFor(created);
      if (!operation) throw new Error("Moderation operation was not created.");
    }

    if (!["approved", "completed"].includes(String(operation.status))) {
      await reviewModerationSamples(chief, String(operation.id));
    }

    const refreshed = await okJson<Json>(
      await chief.get(Routes.PHASE4_ASSESSMENT_CATALOG),
      "assessment catalog refresh",
    );
    const activeOperation = operationFor(refreshed) ?? operation;
    if (!activeOperation) throw new Error("Moderation operation was not found.");

    if (!["approved", "completed"].includes(String(activeOperation.status))) {
      const decision = await chief.post(
        RouteBuilders.phase4ModerationDecision(String(activeOperation.id)),
        {
          version: Number(activeOperation.version ?? 1),
          decision: "approve",
          reason: "Independent moderation review completed with recorded evidence.",
        },
      );
      must(decision.status(), [200], "moderation decision", {});
    }

    const workflow = await okJson<Json>(
      await chief.get(Routes.EVALUATION_WORKFLOW_CATALOG),
      "evaluation workflow catalog",
    );
    const report = ((workflow.reports ?? []) as Json[]).find(
      (candidate) =>
        candidate.kind === "moderation" &&
        candidate.group_id === state.ids.group &&
        candidate.evaluator_id === state.ids.evaluatorProfile,
    );
    if (!report) {
      const created = await chief.post(Routes.EVALUATION_WORKFLOW_REPORTS, {
        packet_id: null,
        group_id: state.ids.group,
        evaluator_id: state.ids.evaluatorProfile,
        kind: "moderation",
      });
      if (![200, 201].includes(created.status())) {
        throw new Error(
          `moderation report: expected 200/201, got ${created.status()} - ${(await created.text()).slice(0, 400)}`,
        );
      }
      const createdReport = (await created.json()) as Json;
      if (createdReport.status !== "submitted") {
        const sent = await chief.post(
          RouteBuilders.evaluationWorkflowReportSend(String(createdReport.id)),
          { version: Number(createdReport.version) },
        );
        must(sent.status(), [200], "send moderation report", {});
      }
    } else if (report.status === "generated") {
      const sent = await chief.post(RouteBuilders.evaluationWorkflowReportSend(report.id), {
        version: Number(report.version),
      });
      must(sent.status(), [200], "send moderation report", {});
    }
  } finally {
    await chief.dispose();
  }
}

/**
 * Forwards the moderation report from the Chairman to Admin.
 * @param state - Ids saved by the provisioning workflow
 * @returns Report id forwarded to Admin
 */
async function chairmanForwardToAdmin(state: WorkflowState): Promise<string> {
  const { email, password } = roleCredentials(state, "chairman", "DVS_CHAIRMAN");
  const chairman = await ApiSession.login(email, password);
  try {
    const workflow = await okJson<Json>(
      await chairman.get(Routes.EVALUATION_WORKFLOW_CATALOG),
      "evaluation workflow catalog",
    );
    const report = ((workflow.reports ?? []) as Json[]).find(
      (candidate) =>
        candidate.kind === "moderation" &&
        candidate.destination === "chairman" &&
        candidate.group_id === state.ids.group,
    );
    if (!report) throw new Error("Chairman has no moderation report to forward.");
    if (!report.forwarded_at) {
      const forwarded = await chairman.post(
        RouteBuilders.evaluationWorkflowReportForwardAdmin(report.id),
        {},
      );
      must(forwarded.status(), [200], "forward report to Admin", {});
    }
    return report.id;
  } finally {
    await chairman.dispose();
  }
}

/**
 * Confirms Admin can see the forwarded report.
 * @param reportId - Report id forwarded by the Chairman
 */
async function adminVerifiesReport(reportId: string): Promise<void> {
  const admin = await ApiSession.login(
    process.env.DVS_ADMIN_EMAIL ?? "",
    process.env.DVS_ADMIN_PASSWORD ?? "",
  );
  try {
    const workflow = await okJson<Json>(
      await admin.get(Routes.EVALUATION_WORKFLOW_CATALOG),
      "evaluation workflow catalog",
    );
    const report = ((workflow.reports ?? []) as Json[]).find(
      (candidate) => candidate.id === reportId,
    );
    if (!report) throw new Error("Admin cannot see the forwarded report.");
    const reachedAdmin =
      report.destination === "admin" ||
      Boolean(report.forwarded_at) ||
      ["sent_to_admin", "admin_review", "reviewed", "forwarded"].includes(String(report.status));
    if (!reachedAdmin) {
      throw new Error(
        `Report did not reach Admin (status ${report.status}, destination ${report.destination}).`,
      );
    }
  } finally {
    await admin.dispose();
  }
}

/**
 * Checks the face status API through the Evaluator browser session.
 * @param page - Authenticated Evaluator page
 * @returns Promise<boolean> - true when enrollment is recorded
 */
export async function isFaceEnrolled(page: Page): Promise<boolean> {
  const base = process.env.WEB_APP_URL;
  if (!base) return false;
  try {
    // The tenant header is required on multi-tenant API calls; without it the
    // status route answers for no tenant and the wait would never complete.
    const tenant = await page
      .evaluate(() => localStorage.getItem("admiezo-active-tenant-id"))
      .catch(() => null);
    const headers: Record<string, string> = {};
    if (tenant) headers["X-Tenant-Id"] = tenant;

    const response = await page.request.get(
      new URL(Routes.EVALUATOR_FACE_STATUS, base).toString(),
      { headers },
    );
    if (!response.ok()) return false;
    const body = (await response.json()) as Record<string, unknown>;
    return body.enrolled === true;
  } catch {
    return false;
  }
}

/**
 * Completes the evaluation from marking to Admin report receipt.
 * @param page - Authenticated Evaluator page after face enrollment
 * @param state - Ids saved by the provisioning workflow
 */
export async function completeEvaluationChain(page: Page, state: WorkflowState): Promise<void> {
  await allocateToEvaluator(state);
  await evaluateAndSubmit(page, state);
  await completeAfterEvaluation(page, state);
}

/**
 * Runs the report, moderation and Admin-receipt steps after the Evaluator has
 * marked and submitted the script in the UI.
 * @param page - Authenticated Evaluator page after submission
 * @param state - Ids saved by the provisioning workflow
 */
export async function completeAfterEvaluation(page: Page, state: WorkflowState): Promise<void> {
  await sendEvaluatorReport(page, state);
  await chiefModerateAndReport(state);
  const reportId = await chairmanForwardToAdmin(state);
  await adminVerifiesReport(reportId);
}
