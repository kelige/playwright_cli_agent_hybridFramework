import { expect, type Locator, type Page } from "@playwright/test";

/**
 * DVS sign-in page.
 * Locators are limited to what has been observed in the deployed application:
 * an email field, a password field and a "Sign in" button.
 */
export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;
  readonly passkeyButton: Locator;
  readonly subtitle: Locator;
  readonly errorMessage: Locator;
  readonly examConfigurationButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.locator('input[type="email"]');
    this.passwordInput = page.locator('input[type="password"]');
    this.signInButton = page.getByRole("button", { name: "Sign in" });
    this.passkeyButton = page.getByRole("button", { name: "Use a passkey", exact: true });
    this.subtitle = page.getByText("Sign in to the evaluation control room.", { exact: true });
    // The Next.js route announcer also exposes role="alert"; scope to the form error.
    // A repeated temporary-credential attempt may surface the lockout message instead.
    this.errorMessage = page
      .getByRole("alert")
      .filter({ hasText: /Unable to sign in|temporarily locked/ });
    this.examConfigurationButton = page.getByRole("button", {
      name: "Exam configuration",
      exact: true,
    });
  }

  private get baseUrl(): string {
    const baseUrl = process.env.WEB_APP_URL;
    if (!baseUrl) {
      throw new Error("Set WEB_APP_URL to the approved DVS environment.");
    }
    return baseUrl;
  }

  async goto(url?: string): Promise<void> {
    await this.page.goto(url ?? this.baseUrl);
  }

  async open(url?: string): Promise<void> {
    await this.goto(url);
    await expect(this.emailInput).toBeVisible();
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.signInButton.click();
  }
}
