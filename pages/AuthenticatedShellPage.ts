import { type Locator, type Page } from "@playwright/test";

/**
 * DVS authenticated shell shown after a successful sign-in.
 * Locators verified against the kim tenant (2026-11-06).
 */
export class AuthenticatedShellPage {
  readonly page: Page;
  readonly mainHeading: Locator;
  readonly primaryNavigation: Locator;
  readonly languageSelector: Locator;
  readonly notificationsButton: Locator;
  readonly accountSettingsButton: Locator;
  /** Icon-only control; the accessible name is exposed through the title attribute. */
  readonly signOutButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.mainHeading = page.getByRole("heading", { name: "Evaluation operations", exact: true });
    this.primaryNavigation = page.getByRole("navigation", { name: "Primary navigation" });
    this.languageSelector = page.getByRole("button", { name: "Select language" });
    this.notificationsButton = page.getByRole("button", { name: "Notifications" });
    this.accountSettingsButton = page.getByRole("button", { name: "Account settings" });
    this.signOutButton = page.getByTitle("Sign out");
  }

  /** Tenant name rendered in the banner and account menu. */
  tenantName(name: string): Locator {
    return this.page.getByText(name, { exact: true }).first();
  }

  /** Sidebar module control for the signed-in role (verified labels in §21). */
  moduleButton(name: string): Locator {
    return this.page.getByRole("button", { name, exact: true });
  }

  /** True when the role's sidebar exposes the module. */
  async isModuleVisible(name: string): Promise<boolean> {
    return this.moduleButton(name).first().isVisible();
  }

  /** True when the authenticated shell is rendered. */
  async isVisible(): Promise<boolean> {
    return this.mainHeading.isVisible();
  }

  /** Opens the account menu; the build keeps sign-out on the shell icon button. */
  async openAccountSettings(): Promise<void> {
    await this.accountSettingsButton.click();
  }

  async signOut(): Promise<void> {
    await this.signOutButton.click();
  }
}
