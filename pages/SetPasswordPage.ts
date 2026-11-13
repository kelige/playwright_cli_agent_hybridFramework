import { expect, type Locator, type Page } from "@playwright/test";

/**
 * DVS first-login "Set your password" screen.
 * Locators verified against the kim tenant (2026-11-06): the screen replaces
 * the one-time credential before the authenticated shell is shown.
 */
export class SetPasswordPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly subtitle: Locator;
  readonly requirementsHeading: Locator;
  readonly newPasswordInput: Locator;
  readonly confirmPasswordInput: Locator;
  readonly setPasswordButton: Locator;
  readonly signOutButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole("heading", { name: "Set your password", exact: true });
    this.subtitle = page.getByText("Secure your university account.", { exact: true });
    this.requirementsHeading = page.getByText("Password requirements:", { exact: true });
    this.newPasswordInput = page.getByLabel("New password", { exact: true });
    this.confirmPasswordInput = page.getByLabel("Confirm password", { exact: true });
    this.setPasswordButton = page.getByRole("button", {
      name: "Set password and continue",
      exact: true,
    });
    this.signOutButton = page.getByRole("button", { name: "Sign out", exact: true });
  }

  /** True while the set-password screen is rendered. */
  async isVisible(): Promise<boolean> {
    return this.heading.isVisible();
  }

  /** Fills both password fields and submits the form. */
  async setPassword(password: string, confirmation: string = password): Promise<void> {
    await this.newPasswordInput.fill(password);
    await this.confirmPasswordInput.fill(confirmation);
    await this.setPasswordButton.click();
  }

  /** Waits for the screen and asserts the required controls exist. */
  async expectOpen(): Promise<void> {
    await expect(this.heading).toBeVisible();
    await expect(this.newPasswordInput).toBeVisible();
    await expect(this.confirmPasswordInput).toBeVisible();
    await expect(this.setPasswordButton).toBeVisible();
  }
}
