import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import { ApiSession, okJson, type Json } from "../../../utils/apiClient";
import { RouteBuilders, Routes } from "../../../api/endpoints/routes";
import { readRunState } from "../../../utils/runState";
import { applyEvaluationTimingPolicy } from "../../../utils/tenantBootstrap";
import {
  beginSecureMarking,
  logProgress,
  markAndSubmit,
  openEvaluatorWorkspace,
  resetFaceFlag,
} from "../../../utils/liveEvaluation";
import { completeAfterEvaluation, type WorkflowState } from "../../../utils/evaluationCompletion";
import {
  openWorkflowSummary,
  saveReportArtifact,
  saveReportDocs,
  saveWorkflowSummary,
} from "../../../utils/reportArtifact";

/**
 * Headed evaluation continuation for one matrix university.
 *
 * The matrix's API workflow already created the academic chain, paper, centre,
 * roles and submitted packet, and saved their ids in the run state. This spec
 * continues from there: the Evaluator passes the live face check in a headed
 * window, marks and submits, then the Chief moderates, the Chairman forwards and
 * the Admin receives the report.
 *
 * It runs one university at a time because the face/liveness check needs a real
 * camera and a human.
 */

const tenantUrl = (process.env.WEB_APP_URL ?? "").replace(/\/+$/, "");
const adminEmail = process.env.DVS_ADMIN_EMAIL ?? "";
const adminPassword = process.env.DVS_ADMIN_PASSWORD ?? "";
const rolePassword =
  process.env.DVS_ROLE_NEW_PASSWORD || process.env.DVS_UNIVERSITY_ADMIN_PASSWORD || "";
const faceTimeoutMs = Number(process.env.FACE_ENROLLMENT_TIMEOUT_MS ?? 0);
const runId = (process.env.DVS_RUN_ID ?? "matrix").toLowerCase();

/**
 * Allocates this run's ready packet to the Evaluator from the Chief's session.
 * Allocation is gated on the Evaluator's attendance, which the face login in
 * this spec records.
 * @param state - Ids saved by the API workflow
 */
async function allocatePacket(state: WorkflowState): Promise<void> {
  const chiefEmail = state.emails?.chief || process.env.DVS_CHIEF_EMAIL || "";
  const chiefPassword = rolePassword || process.env.DVS_CHIEF_PASSWORD || "";
  if (!chiefEmail || !chiefPassword) {
    throw new Error("The Chief Examiner credentials are missing for allocation.");
  }

  const chief = await ApiSession.login(chiefEmail, chiefPassword);
  try {
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

    // A retry may find the packet already assigned; that is success.
    const catalog = await okJson(
      await chief.get(RouteBuilders.allocationCatalogWorkflow(true)),
      "allocation catalog",
    );
    const alreadyAssigned = ((catalog.assignments ?? []) as Json[]).some(
      (assignment) =>
        assignment.evaluator_id === state.ids.evaluatorProfile &&
        (assignment.group_id === state.ids.group || assignment.group_id === group.group_id),
    );
    if (alreadyAssigned) return;

    throw new Error(
      `Allocation failed (${allocated.status()}): ${(await allocated.text()).slice(0, 400)}`,
    );
  } finally {
    await chief.dispose();
  }
}

test.describe("University matrix — headed evaluation @master @end-to-end", () => {
  test.skip(!tenantUrl, "Run the matrix API phase first.");
  test.skip(!adminEmail || !adminPassword, "The Admin credentials are missing.");
  test.skip(!rolePassword, "Set DVS_ROLE_NEW_PASSWORD.");

  // The face steps wait for a human indefinitely by default.
  test.setTimeout(0);

  test("evaluates the submitted packet and delivers the Admin report", async ({ browser }) => {
    const state = readRunState() as unknown as WorkflowState;
    if (!state.ids || !state.ids.evaluatorProfile || !state.ids.paper) {
      test.skip(true, "The API phase did not save a packet for this university.");
    }

    const evaluatorEmail = state.emails?.evaluator || process.env.DVS_EVALUATOR_EMAIL || "";
    if (!evaluatorEmail) throw new Error("The Evaluator email is missing from the run state.");

    // Keeps this tenant at minimum submission time 0 even if a rerun changed it.
    await applyEvaluationTimingPolicy(tenantUrl, adminEmail, adminPassword);

    resetFaceFlag();
    logProgress(`opening the evaluator workspace for ${tenantUrl}`);
    const { page, context } = await openEvaluatorWorkspace(
      browser,
      evaluatorEmail,
      rolePassword,
      faceTimeoutMs,
    );

    // The main face verification is done. Open the next university's window now;
    // this one continues through allocation, marking and reporting on its own.
    const readyFile = process.env.DVS_FACE_READY_FILE?.trim();
    if (readyFile) {
      fs.mkdirSync(path.dirname(readyFile), { recursive: true });
      fs.writeFileSync(readyFile, new Date().toISOString());
      logProgress("face verified; next university may start");
    }

    try {
      await test.step("Chief allocates the ready packet", async () => {
        await allocatePacket(state);
      });

      await test.step("Evaluator passes the face check, marks and submits", async () => {
        logProgress("reloading the evaluation desk");
        await page.reload();
        await beginSecureMarking(page, faceTimeoutMs);
        await markAndSubmit(page);
      });

      await test.step("moderation, Chairman forwarding and Admin receipt", async () => {
        await completeAfterEvaluation(page, state);
      });
    } finally {
      await context.close();
    }

    await test.step("save the Admin result report", async () => {
      const admin = await ApiSession.login(adminEmail, adminPassword);
      try {
        const workflow = await okJson(
          await admin.get(Routes.EVALUATION_WORKFLOW_CATALOG),
          "evaluation workflow catalog",
        );
        const report = ((workflow.reports ?? []) as Json[]).find(
          (candidate) =>
            candidate.kind === "moderation" &&
            (candidate.destination === "admin" || Boolean(candidate.forwarded_at)),
        );
        expect(report, "the moderation report reached Admin").toBeTruthy();

        const detail = await okJson(
          await admin.get(RouteBuilders.evaluationWorkflowReport(report!.id)),
          "report detail",
        );
        const saved = saveReportArtifact(String(report!.id), report!, detail, tenantUrl);
        const workbook = saveReportDocs(
          String(report!.id),
          report!,
          detail,
          tenantUrl,
          state.university?.name ?? process.env.DVS_TENANT_NAME ?? "",
          runId,
        );
        const summary = saveWorkflowSummary(String(report!.id), {
          runId,
          tenantUrl,
          spreadsheetPath: workbook.xlsxPath,
          csvPath: workbook.csvPath,
          entries: [
            {
              title: "University evaluated and Admin report received",
              details: [{ label: "University", value: state.university?.name ?? "" }],
            },
          ],
        });
        console.log(`REPORT ${report!.id}: ${saved.htmlPath}`);
        console.log(`EXCEL ${workbook.xlsxPath} (${workbook.rowCount} scripts)`);
        console.log(`SUMMARY ${summary.latestPath}`);
        openWorkflowSummary(summary.latestPath);
      } finally {
        await admin.dispose();
      }
    });
  });
});
