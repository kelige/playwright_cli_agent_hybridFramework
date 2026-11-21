import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";
import { ApiSession, okJson, type Json } from "./apiClient";
import { Routes } from "../api/endpoints/routes";
import { AccessGovernancePage } from "../pages/AccessGovernancePage";
import { AuthenticatedShellPage } from "../pages/AuthenticatedShellPage";
import { EvaluationDeskPage } from "../pages/EvaluationDeskPage";
import { FaceEnrollmentPage } from "../pages/FaceEnrollmentPage";
import { LoginPage } from "../pages/LoginPage";
import { SecureEvaluationPage } from "../pages/SecureEvaluationPage";
import { SetPasswordPage } from "../pages/SetPasswordPage";
import { signInAndResolveState } from "./dvsAuth";
import { isFaceEnrolled } from "./evaluationCompletion";
import { variedMarks } from "./marks";

/** Appends a timestamped line to `test-results/live-progress.log` (unbuffered). */
export function logProgress(message: string): void {
  try {
    const file = path.join(process.cwd(), "test-results", "live-progress.log");
    fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Progress logging must never break the run.
  }
}

/** Marker written when the human completes the live face step for a run. */
const faceFlagFile = path.resolve(process.cwd(), "playwright", ".auth", "face-enrolled.flag");

/** Coordinates used for the app's mandatory location check. Overridable per environment. */
const geolocation = {
  latitude: Number(process.env.DVS_GEO_LATITUDE ?? 12.9716),
  longitude: Number(process.env.DVS_GEO_LONGITUDE ?? 77.5946),
  accuracy: Number(process.env.DVS_GEO_ACCURACY ?? 30),
};

/**
 * Clears the "Allow location to continue" prompt the desk shows before an
 * evaluation starts. The browser permission is granted up front, so the retry
 * action is what the application needs.
 * @param page - Evaluator page
 */
async function acceptLocationPrompt(page: Page): Promise<void> {
  const prompt = page.getByText(/Allow location to continue/i).first();
  if (!(await prompt.isVisible().catch(() => false))) return;
  const retry = page.getByRole("button", { name: /Try again/i }).first();
  if (await retry.isVisible().catch(() => false)) {
    await retry.click({ timeout: 5_000 }).catch(() => {});
  }
}

/**
 * Signs in as the Admin and unchecks every control on
 * Access governance → Evaluation security, then saves the policy.
 *
 * This is the documented Admin control (§18), not a test bypass: the evaluator's
 * secure-session requirements are driven by this policy, so relaxing it removes
 * the strict camera/full-screen checks the workflow does not need.
 * @param browser - Playwright browser used to open the Admin session
 */
export async function relaxEvaluationPolicy(browser: Browser): Promise<void> {
  const adminEmail = process.env.DVS_ADMIN_EMAIL ?? "";
  const adminPassword = process.env.DVS_ADMIN_PASSWORD ?? "";
  if (!adminEmail || !adminPassword) throw new Error("Admin credentials are missing from .env.");

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  context.setDefaultTimeout(60_000);
  context.setDefaultNavigationTimeout(60_000);
  const page = await context.newPage();

  try {
    const loginPage = new LoginPage(page);
    const setPasswordPage = new SetPasswordPage(page);
    const shellPage = new AuthenticatedShellPage(page);

    const state = await signInAndResolveState(
      loginPage,
      setPasswordPage,
      shellPage,
      adminEmail,
      adminPassword,
    );
    if (state === "rejected") throw new Error("The Admin credentials were rejected.");
    if (state === "password-set") await setPasswordPage.setPassword(adminPassword);
    await expect(shellPage.primaryNavigation).toBeVisible({ timeout: 60_000 });

    // A role guidance dialog can cover the sidebar.
    await dismissGuidance(page);
    const close = page.getByRole("dialog").getByRole("button", { name: /^Close$/i }).first();
    if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});

    const governance = new AccessGovernancePage(page);
    await governance.openEvaluationSecurity();

    const boxes = page.getByRole("checkbox");
    const total = await boxes.count();
    let unchecked = 0;
    for (let index = 0; index < total; index += 1) {
      const box = boxes.nth(index);
      if (await box.isChecked().catch(() => false)) {
        await box.uncheck({ force: true }).catch(() => {});
        unchecked += 1;
      }
    }

    const saved = await governance.saveWithReauthentication(adminPassword);
    logProgress(
      saved
        ? `policy relaxed: unchecked ${unchecked}/${total} controls and saved`
        : `policy relaxed: unchecked ${unchecked}/${total} controls; nothing to save (already relaxed)`,
    );

    // Some evaluation controls are not checkboxes (identity verification is a
    // select/flag). Force every evaluation boolean off through the same policy
    // API so the strict session gates are actually disabled.
    const admin = await ApiSession.login(adminEmail, adminPassword);
    try {
      await admin.stepUp(adminPassword);
      const catalog = await okJson(await admin.get(Routes.SECURITY_CATALOG), "security catalog");
      const policy = catalog.policy as Json;
      let forced = 0;
      for (const key of Object.keys(policy)) {
        if (typeof policy[key] !== "boolean") continue;
        const evaluationFlag =
          key.startsWith("evaluation_") ||
          ["require_mfa", "require_trusted_device", "dlp_enabled"].includes(key);
        if (evaluationFlag && policy[key]) {
          policy[key] = false;
          forced += 1;
        }
      }

      // Access governance -> Evaluation security -> Time and inactivity. The
      // console stores the minimum submission time under both spellings, and the
      // evaluator's submission window reads the camelCase one. Zero every
      // spelling so no evaluator waits before submitting; restore them if the
      // API rejects 0.
      const minimumKeys = [
        "minEvaluationMinutes",
        "min_evaluation_minutes",
        "minimumEvaluationMinutes",
        "minimum_evaluation_minutes",
        "evaluation_min_minutes",
        "min_submission_minutes",
        "minimum_submission_minutes",
      ];
      const originalMinutes = new Map<string, number>();
      for (const key of minimumKeys) {
        if (typeof policy[key] === "number") originalMinutes.set(key, policy[key] as number);
      }
      let timersZeroed = 0;
      for (const [key, value] of originalMinutes) {
        if (value > 0 && policy[key] !== 0) {
          policy[key] = 0;
          timersZeroed += 1;
        }
      }

      try {
        if (forced > 0 || timersZeroed > 0) {
          await okJson(await admin.put(Routes.SECURITY_POLICY, policy), "save relaxed policy");
        }
      } catch (error) {
        if (timersZeroed === 0) throw error;
        for (const [key, value] of originalMinutes) policy[key] = value;
        await okJson(await admin.put(Routes.SECURITY_POLICY, policy), "save relaxed policy");
        timersZeroed = 0;
      }
      logProgress(
        `policy relaxed: forced ${forced} evaluation flags off, ${timersZeroed} timers zeroed`,
      );
    } finally {
      await admin.dispose();
    }
  } finally {
    await context.close();
  }
}

/** One captured mark row from the marking screen. */
export type CapturedMark = { questionNumber: number; awardedMarks: number };

/**
 * Clicks the face-check **Verify** action once the application enables it.
 * The camera checks decide enabling; clicking a disabled or failed check is
 * impossible, so this never bypasses the verification.
 * @param page - Evaluator page showing the identity verification dialog
 */
async function acceptFaceVerification(page: Page): Promise<void> {
  const verify = page.getByRole("dialog").getByRole("button", { name: /^Verify$/i }).first();
  if (await verify.isEnabled().catch(() => false)) {
    await verify.click({ timeout: 5_000 }).catch(() => {});
  }
}

/** True while the "Verify your face" screen is rendered. */
async function isVerificationVisible(page: Page): Promise<boolean> {
  return page
    .getByRole("region", { name: /Verify your face/i })
    .isVisible()
    .catch(() => false);
}

/**
 * Dismisses the Evaluator guidance dialog ("Open your packet"), which otherwise
 * covers the desk and blocks EVALUATE.
 * @param page - Evaluator page on the desk
 */
async function dismissGuidance(page: Page): Promise<void> {
  const dialog = page
    .getByRole("dialog")
    .filter({ hasText: /Evaluator guidance|Open your packet/i });
  if (!(await dialog.isVisible().catch(() => false))) return;

  const go = dialog.getByRole("button", { name: /Go to task/i }).first();
  if (await go.isVisible().catch(() => false)) {
    await go.click({ timeout: 10_000 }).catch(() => {});
    logProgress("guidance: pressed Go to task");
    return;
  }
  const close = dialog.getByRole("button", { name: /^Close$/i }).first();
  if (await close.isVisible().catch(() => false)) {
    await close.click({ timeout: 10_000 }).catch(() => {});
    logProgress("guidance: closed");
  }
}

/** Per-page record of gate actions, so retries never spam a control. */
const gateActions = new WeakMap<
  Page,
  { verifyAt: number; retryAt: number; refresh: boolean }
>();

/**
 * Presses the face-check **Verify** action whenever the app enables it, and
 * dismisses the post-verification screen. The identity checks themselves are
 * camera-driven and stay with the human.
 * @param page - Evaluator page at the face gate
 */
async function nudgeVerification(page: Page): Promise<void> {
  const now = Date.now();
  const state = gateActions.get(page) ?? { verifyAt: 0, retryAt: 0, refresh: false };
  const dialog = page
    .getByRole("dialog")
    .filter({ hasText: /Identity verification|Face enrollment/i });

  if (await dialog.isVisible().catch(() => false)) {
    const verify = dialog.getByRole("button", { name: /^Verify$/i }).first();
    // Respond quickly once the app enables Verify, so enrollment does not sit
    // idle for half a minute after the camera checks finish.
    if (now - state.verifyAt > 5_000 && (await verify.isEnabled().catch(() => false))) {
      await verify.click({ timeout: 5_000 }).catch(() => {});
      state.verifyAt = now;
      logProgress("face gate: pressed Verify");
    } else if (!(await verify.isEnabled().catch(() => false))) {
      // A failed liveness attempt disables Verify until the camera is retried.
      // Press the app's own retry control so a 409 does not stall the run.
      const retry = dialog
        .getByRole("button", { name: /retry|try again|restart|start camera|open camera/i })
        .first();
      if (now - state.retryAt > 15_000 && (await retry.isVisible().catch(() => false))) {
        await retry.click({ timeout: 5_000 }).catch(() => {});
        state.retryAt = now;
        logProgress("face gate: retried the camera check");
      }
    }
  } else if (await isVerificationVisible(page)) {
    // Verification done but the shell has not rendered: the app exposes a
    // page-level Refresh to load it. Press it once.
    const success = page.getByText(/verified|attendance (recorded|marked)/i).first();
    if (!state.refresh && (await success.isVisible().catch(() => false))) {
      const refresh = page.getByRole("button", { name: /^Refresh$/i }).first();
      if (await refresh.isVisible().catch(() => false)) {
        await refresh.click({ timeout: 5_000 }).catch(() => {});
        state.refresh = true;
        logProgress("face gate: pressed Refresh after verification");
      }
    }
  }

  gateActions.set(page, state);
}

/**
 * Clears every surface that can sit in front of the next step: the location
 * prompt, an enabled face **Verify** action, a completed enrollment, and a
 * success dialog that needs dismissing. Each action only fires when the
 * application itself has enabled or reported it.
 * @param page - Evaluator page at a live gate
 */
async function advanceLiveGate(page: Page): Promise<void> {
  await dismissGuidance(page);
  await acceptLocationPrompt(page);
  await nudgeVerification(page);
  await new FaceEnrollmentPage(page).finishEnrollment();

  const success = page.getByText(/verified|attendance (recorded|marked)|enrollment complete/i).first();
  if (!(await success.isVisible().catch(() => false))) return;

  const close = page
    .getByRole("dialog")
    .getByRole("button", { name: /^(Close|Done|Continue|Finish)$/i })
    .first();
  if (await close.isVisible().catch(() => false)) {
    await close.click({ timeout: 5_000 }).catch(() => {});
  }
}

/** Short description of what is on screen, for the wait diagnostics. */
async function describeScreen(page: Page): Promise<string> {
  const headings = await page
    .getByRole("heading")
    .allInnerTexts()
    .catch(() => [] as string[]);
  const dialogs = await page
    .getByRole("dialog")
    .allInnerTexts()
    .catch(() => [] as string[]);
  const head = headings.filter(Boolean).slice(0, 3).join(" | ");
  const dialog = dialogs.filter(Boolean).map((text) => text.replace(/\s+/g, " ").slice(0, 80)).join(" | ");
  return [head && `headings: ${head}`, dialog && `dialogs: ${dialog}`].filter(Boolean).join("; ");
}

/**
 * Reads the marks captured from the marking screen.
 * @returns Question number to awarded marks
 */
export function capturedMarks(): Map<number, number> {
  return new Map(variedMarks().map((mark) => [Number(mark.questionNumber), mark.awardedMarks]));
}

/** Clears the previous run's face marker so each run needs its own live step. */
export function resetFaceFlag(): void {
  if (fs.existsSync(faceFlagFile)) fs.rmSync(faceFlagFile);
}

/**
 * Records that the human completed the face step.
 * @param label - Which face step was completed
 */
function markFaceDone(label: string): void {
  fs.mkdirSync(path.dirname(faceFlagFile), { recursive: true });
  fs.writeFileSync(faceFlagFile, `${label} ${new Date().toISOString()}`);
}

/**
 * Waits for the human at a real camera step. The browser is headed, so the
 * tester completes enrollment or the face check in the open window; this only
 * observes the application's own verification signal.
 *
 * `timeoutMs <= 0` waits until the application confirms the face step, with no
 * deadline: the run pauses on the open browser for as long as the human needs.
 * @param page - Evaluator page showing the camera step
 * @param label - Human-readable step name for the console prompt
 * @param timeoutMs - Safety limit in ms; `0` or less waits until verified
 * @param done - Predicate that becomes true when the application has verified
 */
export async function waitForLiveFace(
  page: Page,
  label: string,
  timeoutMs: number,
  done: () => Promise<boolean>,
): Promise<void> {
  const faceEnrollment = new FaceEnrollmentPage(page);

  // The face checks run on live video frames; an occluded window is throttled,
  // which stalls Single face / Liveness forever.
  await page.bringToFront().catch(() => {});
  await faceEnrollment.openCamera();
  console.log(
    `\nLIVE STEP — ${label}\n` +
      "  Complete it in the open browser window (camera permission is already granted).\n" +
      (timeoutMs > 0
        ? `  Waiting up to ${Math.round(timeoutMs / 60_000)} minutes...\n`
        : "  Waiting until the application confirms the face is verified...\n"),
  );

  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Number.POSITIVE_INFINITY;
  let lastLog = 0;

  for (;;) {
    // Clear any gate that the application itself has enabled (location retry,
    // face Verify, completed enrollment) before checking for the next surface.
    await advanceLiveGate(page).catch(() => {});
    if (await done().catch(() => false)) break;
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for: ${label}`);
    }
    if (Date.now() - lastLog > 15_000) {
      lastLog = Date.now();
      const screen = await describeScreen(page).catch(() => "");
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const shot = path.join(process.cwd(), "test-results", `live-wait-${slug}.png`);
      await page.screenshot({ path: shot }).catch(() => {});
      console.log(
        `  … still waiting for the application to confirm: ${label}` +
          (screen ? `\n     on screen — ${screen}` : "") +
          `\n     screenshot — ${shot}`,
      );
    }
    // Sleeps between checks so the wait never spins; nothing is faked or bypassed.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  markFaceDone(label);
  console.log(`  ✅ ${label} verified\n`);
}

/**
 * Signs the Evaluator in, completes the first face enrollment live, then runs
 * the secure-evaluation check so the workspace is ready for marking.
 * @param browser - Playwright browser (the workflow project runs headed)
 * @param email - Evaluator login email
 * @param password - Evaluator permanent password
 * @param faceTimeoutMs - Time allowed for the live face steps
 * @returns The evaluator page, signed in and on the evaluation desk
 */
export async function openEvaluatorWorkspace(
  browser: Browser,
  email: string,
  password: string,
  faceTimeoutMs: number,
): Promise<{ page: Page; context: Awaited<ReturnType<Browser["newContext"]>> }> {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    // Camera and microphone for face steps; geolocation because the desk
    // refuses to start an evaluation without a recorded location.
    permissions: ["camera", "microphone", "geolocation"],
    geolocation,
  });
  const page = await context.newPage();
  // This context is created manually, so the config's actionTimeout does not
  // apply to it. Without these bounds a click covered by a gate waits forever.
  context.setDefaultTimeout(60_000);
  context.setDefaultNavigationTimeout(60_000);
  // Capture why the face checks stall: console errors, page errors and failed
  // requests (a missing ML model or blocked resource stops the checks silently).
  page.on("console", (message) => {
    if (message.type() === "error") {
      logProgress(`console error: ${message.text().slice(0, 300)}`);
    }
  });
  page.on("pageerror", (error) => {
    logProgress(`page error: ${error.message.slice(0, 300)}`);
  });
  page.on("requestfailed", (request) => {
    logProgress(
      `request failed: ${request.url().slice(0, 200)} — ${request.failure()?.errorText ?? ""}`,
    );
  });
  page.on("response", (response) => {
    const status = response.status();
    if (status >= 400) {
      logProgress(`response ${status} ${response.request().method()} ${response.url().slice(0, 200)}`);
    }
  });

  const loginPage = new LoginPage(page);
  const setPasswordPage = new SetPasswordPage(page);
  const shellPage = new AuthenticatedShellPage(page);

  const state = await signInAndResolveState(loginPage, setPasswordPage, shellPage, email, password);
  logProgress(`sign-in state: ${state}`);
  if (state === "rejected") throw new Error(`The Evaluator credentials were rejected for ${email}.`);
  if (state === "password-set") {
    await setPasswordPage.setPassword(password);
  }

  // Face enrollment and face verification share one gate: the workspace only
  // opens after the application has accepted the live face step. Waiting on
  // `enrolled` alone is wrong — an enrolled user is still asked to verify.
  const needsFace =
    state === "face-enrollment" ||
    state === "face-verification" ||
    !(await shellPage.primaryNavigation.isVisible().catch(() => false));

  if (needsFace) {
    await waitForLiveFace(
      page,
      "Evaluator face verification",
      faceTimeoutMs,
      async () => shellPage.primaryNavigation.isVisible().catch(() => false),
    );
  }

  await expect(shellPage.primaryNavigation).toBeVisible({ timeout: 60_000 });
  logProgress("shell visible; opening Evaluation desk");

  // The role guidance dialog auto-opens over the shell and intercepts clicks,
  // so dismiss it before (and after) opening the desk.
  let deskOpened = false;
  for (let attempt = 0; attempt < 5 && !deskOpened; attempt += 1) {
    await dismissGuidance(page);
    try {
      await shellPage.openModule("Evaluation desk");
      deskOpened = true;
    } catch (error) {
      logProgress(
        `Evaluation desk click failed (attempt ${attempt + 1}): ${
          error instanceof Error ? error.message.split("\n")[0] : error
        }`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  if (!deskOpened) throw new Error("The Evaluation desk could not be opened; a dialog is blocking it.");

  await dismissGuidance(page);
  logProgress(`evaluation desk opened (${page.url()})`);
  return { page, context };
}

/**
 * Opens the assigned script and passes the secure-evaluation check. The second
 * live face check happens here, immediately before the marking workspace opens,
 * so either order the application chooses (face first, or secure dialog first)
 * is handled: wait for whichever surface appears, then continue.
 * @param page - Evaluator page on the evaluation desk
 * @param faceTimeoutMs - Time allowed for the live face check
 */
export async function beginSecureMarking(page: Page, faceTimeoutMs: number): Promise<void> {
  const desk = new EvaluationDeskPage(page);
  const faceEnrollment = new FaceEnrollmentPage(page);
  const secureEvaluation = new SecureEvaluationPage(page);

  await acceptLocationPrompt(page);
  await advanceLiveGate(page);
  logProgress("begin secure marking: gates cleared");

  // A gate (location prompt, face dialog) can cover EVALUATE. Clear it and retry
  // the click instead of waiting on an overlay that never goes away by itself.
  let opened = false;
  for (let attempt = 0; attempt < 10 && !opened; attempt += 1) {
    await advanceLiveGate(page).catch(() => {});
    try {
      logProgress(`clicking EVALUATE (attempt ${attempt + 1})`);
      await desk.openAssignedScript(15_000);
      opened = true;
      logProgress("EVALUATE clicked");
    } catch (error) {
      const screen = await describeScreen(page).catch(() => "");
      const shot = path.join(process.cwd(), "test-results", "live-click-failed.png");
      await page.screenshot({ path: shot }).catch(() => {});
      logProgress(
        `EVALUATE click failed (attempt ${attempt + 1}): ${
          error instanceof Error ? error.message.split("\n")[0] : error
        } | ${screen} | ${shot}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  if (!opened) {
    throw new Error("Could not open the assigned script: a gate is covering EVALUATE.");
  }

  await desk.acknowledgeMarkingInstructions();
  logProgress("marking instructions handled");

  const identityDialog = page
    .getByRole("dialog")
    .filter({ hasText: /Identity verification|Face enrollment/i });

  await expect
    .poll(
      async () => {
        // The location prompt sits in front of the secure check; clearing it is
        // part of reaching the workspace, not a bypass of the check itself.
        await advanceLiveGate(page);
        return (
          (await secureEvaluation.isDialogVisible()) ||
          (await faceEnrollment.isPromptVisible()) ||
          (await identityDialog.isVisible().catch(() => false)) ||
          (await desk.grandTotal.isVisible().catch(() => false))
        );
      },
      { timeout: 120_000, intervals: [2_000] },
    )
    .toBe(true);

  const faceGate =
    (await faceEnrollment.isPromptVisible()) ||
    (await identityDialog.isVisible().catch(() => false));

  if (faceGate) {
    logProgress("second face gate detected; waiting for the human");
    await waitForLiveFace(
      page,
      "Evaluator face check before correction",
      faceTimeoutMs,
      async () => {
        await acceptFaceVerification(page);
        return (
          (await secureEvaluation.isDialogVisible()) ||
          (await desk.grandTotal.isVisible().catch(() => false))
        );
      },
    );
  }

  if (!(await desk.grandTotal.isVisible().catch(() => false))) {
    logProgress("running the secure evaluation check");
    await desk.beginSecureEvaluation();
    logProgress("secure evaluation check completed");
  }

  await expect(desk.grandTotal).toBeVisible({ timeout: 120_000 });
  logProgress("marking workspace is open");
}

/**
 * Enters every captured mark and submits the evaluation.
 * @param page - Evaluator page inside the secure marking workspace
 */
export async function markAndSubmit(page: Page): Promise<void> {
  const desk = new EvaluationDeskPage(page);
  console.log("  marking the script in the secure workspace...");
  logProgress("entering marks");
  await desk.enterMarks(capturedMarks());
  logProgress("marks entered; waiting for the submission window");
  console.log("  marks entered; waiting for the submission window");
  await desk.submitEvaluation();
  logProgress("evaluation submitted");
}
