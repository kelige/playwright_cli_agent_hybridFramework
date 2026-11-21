import { type Locator, type Page } from "@playwright/test";

/**
 * Secure evaluation check dialog and workspace entry.
 * Locators are taken from prompts/KTR_WEB_TEST_PROMPTS.md §16.3, §16.4 and §21.
 */
export class SecureEvaluationPage {
  private readonly page: Page;

  // Locators
  private readonly secureCheckDialog: Locator;
  private readonly acknowledgementCheckbox: Locator;
  private readonly runChecksButton: Locator;
  private readonly beginButton: Locator;

  constructor(page: Page) {
    this.page = page;

    // Initialize locators
    this.secureCheckDialog = page
      .getByRole("dialog")
      .filter({ hasText: /Secure evaluation check/i })
      .first();
    this.acknowledgementCheckbox = this.secureCheckDialog.getByRole("checkbox").first();
    this.runChecksButton = this.secureCheckDialog
      .getByRole("button", { name: /Run security checks/i })
      .first();
    this.beginButton = this.secureCheckDialog
      .getByRole("button", { name: /Begin secure evaluation/i })
      .first();
  }

  /**
   * Checks whether the secure evaluation check dialog is visible.
   * @returns Promise<boolean> - true when the dialog is rendered
   */
  async isDialogVisible(): Promise<boolean> {
    try {
      return await this.secureCheckDialog.isVisible();
    } catch (error) {
      console.log(`Error checking secure evaluation dialog: ${error}`);
      return false;
    }
  }

  /**
   * Acknowledges the monitoring policy and runs the security checks.
   */
  async acknowledgeAndRunChecks(): Promise<void> {
    await this.acknowledgementCheckbox.check().catch(() => false);
    if (await this.runChecksButton.isVisible().catch(() => false)) {
      await this.runChecksButton.click();
    }
  }

  /**
   * Checks whether the fullscreen control is enabled after the checks pass.
   * @returns Promise<boolean> - true when Begin secure evaluation is enabled
   */
  async isBeginEnabled(): Promise<boolean> {
    return this.beginButton.isEnabled().catch(() => false);
  }

  /**
   * Starts the secure evaluation workspace.
   */
  async beginSecureEvaluation(): Promise<void> {
    await this.beginButton.click();
  }
}
