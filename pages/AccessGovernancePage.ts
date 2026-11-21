import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Admin "Access governance" workspace, Evaluation security tab.
 * Locators verified against the brahma tenant (2026-11-12).
 */
export class AccessGovernancePage {
  readonly page: Page;
  readonly sidebarButton: Locator;
  readonly evaluationSecurityTab: Locator;
  readonly savePolicyButton: Locator;
  readonly reauthenticateDialog: Locator;
  readonly reauthPasswordInput: Locator;
  readonly reauthVerifyButton: Locator;
  readonly savedVersionText: Locator;

  constructor(page: Page) {
    this.page = page;
    this.sidebarButton = page.getByRole("button", { name: "Access governance", exact: true });
    this.evaluationSecurityTab = page.getByRole("button", { name: "Evaluation security", exact: true });
    this.savePolicyButton = page.getByRole("button", { name: "Save evaluation policy" });
    this.reauthenticateDialog = page.getByRole("dialog").filter({ hasText: "Re-authenticate" });
    this.reauthPasswordInput = this.reauthenticateDialog.locator('input[type="password"]');
    this.reauthVerifyButton = this.reauthenticateDialog.getByRole("button", { name: "Verify" });
    this.savedVersionText = page.getByText(/Saved .* Version \d+/);
  }

  /** Opens Access governance and switches to the Evaluation security tab. */
  async openEvaluationSecurity(): Promise<void> {
    await this.sidebarButton.click();
    await this.evaluationSecurityTab.click();
    await expect(this.savePolicyButton).toBeVisible();
  }

  /** Evaluator-control checkbox by its visible label, e.g. "Keep camera on". */
  control(name: string): Locator {
    return this.page.getByRole("checkbox", { name, exact: true });
  }

  /** Sets a control to the wanted state; no-op when it is already there. */
  async setControl(name: string, checked: boolean): Promise<void> {
    await this.control(name).setChecked(checked);
  }

  /**
   * Saves the evaluation policy and completes the sensitive-action re-authentication
   * when the app asks for it (it does not while a recent step-up is still valid).
   *
   * The button is only enabled while the form is dirty. A re-run on an already
   * relaxed policy has nothing to save, so this returns `false` instead of
   * waiting on a disabled control.
   * @param adminPassword - The acting Admin's own password
   * @returns Whether a save was submitted
   */
  async saveWithReauthentication(adminPassword: string): Promise<boolean> {
    if (!(await this.savePolicyButton.isEnabled().catch(() => false))) return false;
    await this.savePolicyButton.click();
    const prompted = await this.reauthenticateDialog
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (prompted) {
      await this.reauthPasswordInput.fill(adminPassword);
      await this.reauthVerifyButton.click();
      await expect(this.reauthenticateDialog).toBeHidden();
    }
    return true;
  }
}
