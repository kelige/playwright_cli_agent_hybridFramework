import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Evaluator "Evaluation desk" and secure marking workspace.
 * Locators verified against the brahma tenant on 2026-11-13; marking labels
 * follow prompts/KTR_WEB_TEST_PROMPTS.md §16.4 and §21.
 */
export class EvaluationDeskPage {
  readonly page: Page;
  readonly evaluateButton: Locator;
  readonly instructionsDialog: Locator;
  readonly secureCheckDialog: Locator;
  readonly beginButton: Locator;
  readonly grandTotal: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.evaluateButton = page.getByRole("button", { name: "EVALUATE", exact: true }).first();
    this.instructionsDialog = page.getByRole("dialog").filter({ hasText: /Review marking instructions/i });
    this.secureCheckDialog = page.getByRole("dialog").filter({ hasText: /Secure evaluation check/i });
    this.beginButton = this.secureCheckDialog.getByRole("button", { name: /Begin secure evaluation/i });
    this.grandTotal = page.getByText(/Grand Total/i).first();
    // The workflow guide renders a stage button named "Open Submit evaluation";
    // anchoring the accessible name keeps the real submit control exclusive.
    this.submitButton = page.getByRole("button", { name: /^Submit evaluation$/i }).first();
  }

  /**
   * Opens the first assigned script from the evaluation queue.
   * @param timeout - Maximum wait for the control and for the click to become actionable
   */
  async openAssignedScript(timeout = 30_000): Promise<void> {
    await expect(this.evaluateButton).toBeVisible({ timeout });
    await this.evaluateButton.click({ timeout });
  }

  /** Accepts the marking instructions shown before the secure check. */
  async acknowledgeMarkingInstructions(): Promise<void> {
    if (await this.instructionsDialog.isVisible().catch(() => false)) {
      await this.instructionsDialog.getByRole("checkbox").first().check();
      await this.instructionsDialog.getByRole("button", { name: /Acknowledge and continue/i }).click();
      await expect(this.instructionsDialog).toBeHidden();
    }
  }

  /** Acknowledges and runs the secure-evaluation checks, then begins the session. */
  async beginSecureEvaluation(): Promise<void> {
    await expect(this.secureCheckDialog).toBeVisible({ timeout: 30_000 });
    await this.secureCheckDialog.getByRole("checkbox").first().check();
    const runChecks = this.secureCheckDialog.getByRole("button", { name: /Run security checks/i });
    if (await runChecks.isVisible().catch(() => false)) {
      await runChecks.click();
    }
    await expect(this.beginButton).toBeEnabled({ timeout: 60_000 });
    await this.beginButton.click();
    await expect(this.grandTotal).toBeVisible({ timeout: 60_000 });
  }

  /** Marks input for a question number, e.g. `Marks for 7`. */
  marksInput(questionNumber: number): Locator {
    return this.page.getByLabel(new RegExp(`^Marks for ${questionNumber}\\b`)).first();
  }

  /**
   * Enters every captured mark and leaves the field so the app saves it.
   * @param marks - Question number to awarded marks
   */
  async enterMarks(marks: Map<number, number>): Promise<void> {
    for (const [questionNumber, awarded] of marks) {
      const input = this.marksInput(questionNumber);
      await expect(input, `Marks for ${questionNumber}`).toBeVisible();
      await input.fill(String(awarded));
      await input.press("Tab");
      await this.page.waitForTimeout(80);
    }
  }

  /**
   * Visits every page of the assigned script. The app counts a page as reviewed
   * only once it has been displayed, and it refuses submission until all pages
   * are visited ("Review every script page before submission").
   */
  async coverAllPages(): Promise<void> {
    const pageInput = this.page.getByLabel("Go to page");
    await expect(pageInput, "script page control").toBeVisible({ timeout: 30_000 });

    const total = Number(await pageInput.getAttribute("max"));
    if (!Number.isFinite(total) || total < 1) {
      throw new Error("The script viewer did not report a page count.");
    }

    const stage = this.page.locator(".document-stage").first();
    const next = this.page.getByRole("button", { name: "Next page" });
    for (let page = 1; page <= total; page += 1) {
      if (page > 1) await next.click();
      await expect(pageInput).toHaveValue(String(page));
      // Nudge the viewer so its scroll handler records the page as visited.
      await stage.evaluate((element) => {
        element.scrollTop += 1;
      });
      await this.page.waitForTimeout(1_200);
    }
    console.log(`  covered ${total} script page${total === 1 ? "" : "s"}`);
  }

  /**
   * Waits for the evaluation timer to reach 00:00:00. The app disables
   * submission while any time remains ("Submission is available after the
   * timer ends.").
   */
  async waitForTimer(): Promise<void> {
    const timer = this.page.locator(".viewer-timer").first();
    if (!(await timer.isVisible().catch(() => false))) return;

    console.log(`  waiting for the evaluation timer (${(await timer.innerText()).trim()})`);
    await expect
      .poll(async () => (await timer.innerText()).trim(), {
        timeout: 180 * 60_000,
        intervals: [5_000],
      })
      .toMatch(/^0+:0+:0+$/);
    console.log("  evaluation timer reached 00:00:00");
  }

  /**
   * Submits the evaluation: covers every page, waits for the timer, confirms
   * the valuation review and the final confirmation dialog.
   */
  async submitEvaluation(): Promise<void> {
    await this.coverAllPages();
    await this.waitForTimer();

    const alert = this.page.getByRole("alertdialog", { name: "Evaluation alert" });
    const review = this.page.getByRole("dialog", { name: "Valuation details" });

    // Marks save asynchronously. The app refuses submission until every save is
    // acknowledged, so retry for a bounded window instead of failing on the
    // first "Marks have not finished saving" alert.
    const saveDeadline =
      Date.now() + Number(process.env.DVS_MARKS_SAVE_WAIT_MS ?? 20_000);
    for (;;) {
      await expect(this.submitButton).toBeVisible({ timeout: 30_000 });
      await expect(this.submitButton).toBeEnabled({ timeout: 30_000 });
      await this.submitButton.click({ timeout: 20_000 });

      const surface = await this.waitForSurface(review, alert, "valuation review");
      if (surface === "expected") break;

      const message = await alert.innerText();
      const stillSaving = /not finished saving/i.test(message);
      if (!stillSaving || Date.now() >= saveDeadline) {
        throw new Error(`Submission blocked at valuation review: ${message}`);
      }
      const dismiss = alert.getByRole("button", { name: /^(OK|Close)$/i }).first();
      if (await dismiss.isVisible().catch(() => false)) {
        await dismiss.click({ timeout: 5_000 }).catch(() => {});
      } else {
        await this.page.keyboard.press("Escape").catch(() => {});
      }
      await expect(alert).toBeHidden({ timeout: 10_000 }).catch(() => {});
      await this.page.waitForTimeout(1_500);
    }

    await review.getByRole("button", { name: "Continue", exact: true }).click();

    const confirm = this.page.getByRole("alertdialog", { name: "Confirm submission" });
    await this.waitForSurface(confirm, alert, "submission confirmation");
    await confirm.getByRole("button", { name: /OK, submit and exit/i }).click();

    await expect(this.page.getByText(/Evaluation submitted/i).first()).toBeVisible({
      timeout: 3 * 60_000,
    });
  }

  /**
   * Waits until the expected dialog appears, and fails immediately with the
   * app's own message when a blocking alert is shown instead.
   * @param expected - Dialog that should appear
   * @param alert - The app's blocking alert dialog
   * @param label - Step description for the failure message
   */
  private async waitForSurface(
    expected: Locator,
    alert: Locator,
    label: string,
  ): Promise<"expected" | "alert"> {
    await expect
      .poll(
        async () =>
          (await alert.isVisible().catch(() => false))
            ? "alert"
            : (await expected.isVisible().catch(() => false))
              ? "expected"
              : "waiting",
        { timeout: 60_000, intervals: [500] },
      )
      .not.toBe("waiting");

    const surface = (await alert.isVisible().catch(() => false)) ? "alert" : "expected";
    if (surface === "alert" && label !== "valuation review") {
      throw new Error(`Submission blocked at ${label}: ${await alert.innerText()}`);
    }
    return surface;
  }
}
