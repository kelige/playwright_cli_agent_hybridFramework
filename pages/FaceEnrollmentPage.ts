import { type Locator, type Page } from "@playwright/test";

/**
 * Face enrollment surface shown on the Evaluator desk before secure evaluation.
 * Locators are taken from prompts/KTR_WEB_TEST_PROMPTS.md §16.2 and §21.
 */
export class FaceEnrollmentPage {
  private readonly page: Page;

  // Locators
  private readonly registerPrompt: Locator;
  private readonly openCameraButton: Locator;
  private readonly enrollButton: Locator;
  private readonly successMessage: Locator;

  constructor(page: Page) {
    this.page = page;

    // Initialize locators
    this.registerPrompt = page.getByText(/Register your face|Verify your face/i).first();
    this.openCameraButton = page.getByRole("button", { name: /Open camera/i }).first();
    this.enrollButton = page.getByRole("button", { name: /^Enroll$/i }).first();
    this.successMessage = page
      .getByText(/face enrolled|enrollment (complete|successful)|face registered|capture complete/i)
      .first();
  }

  /**
   * Checks whether the face enrollment prompt is rendered.
   * @returns Promise<boolean> - true when the enrollment prompt is visible
   */
  async isPromptVisible(): Promise<boolean> {
    try {
      return (await this.registerPrompt.isVisible()) || (await this.openCameraButton.isVisible());
    } catch (error) {
      console.log(`Error checking face enrollment prompt: ${error}`);
      return false;
    }
  }

  /**
   * Opens the camera prompt used before enrollment.
   */
  async openCamera(): Promise<void> {
    if (await this.openCameraButton.isVisible().catch(() => false)) {
      await this.openCameraButton.click();
    }
  }

  /**
   * Checks whether the enrollment prompt or the Enroll control is available.
   * @returns Promise<boolean> - true when the enrollment dialog is rendered
   */
  async isEnrollmentDialogVisible(): Promise<boolean> {
    try {
      return (await this.enrollButton.isVisible()) || (await this.registerPrompt.isVisible());
    } catch (error) {
      console.log(`Error checking face enrollment dialog: ${error}`);
      return false;
    }
  }

  /**
   * Checks whether the application reports a completed enrollment/capture.
   * @returns Promise<boolean> - true when the success message is visible
   */
  async isEnrollmentComplete(): Promise<boolean> {
    try {
      return await this.successMessage.isVisible();
    } catch (error) {
      console.log(`Error checking face enrollment result: ${error}`);
      return false;
    }
  }

  /**
   * Dismisses the enrollment dialog after the application reports success so the
   * shell can render. Only acts once the success state is visible.
   */
  async finishEnrollment(): Promise<void> {
    if (!(await this.isEnrollmentComplete())) return;
    const dialog = this.page.getByRole("dialog").filter({ hasText: /Face enrollment/i });
    const done = dialog
      .getByRole("button", { name: /^(Done|Continue|Finish|Close)$/i })
      .or(this.page.getByRole("button", { name: /^(Done|Continue to|Finish)$/i }))
      .first();
    if (await done.isVisible().catch(() => false)) {
      await done.click({ timeout: 5_000 }).catch(() => {});
    }
  }
}
