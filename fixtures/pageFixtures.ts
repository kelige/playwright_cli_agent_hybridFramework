import { expect, test as base, type Page } from "@playwright/test";
import { AccessGovernancePage } from "../pages/AccessGovernancePage";
import { AuthenticatedShellPage } from "../pages/AuthenticatedShellPage";
import { ExamConfigurationPage } from "../pages/ExamConfigurationPage";
import { LoginPage } from "../pages/LoginPage";
import { SetPasswordPage } from "../pages/SetPasswordPage";

export type PageFixtures = {
  loginPage: LoginPage;
  setPasswordPage: SetPasswordPage;
  shellPage: AuthenticatedShellPage;
  examConfigurationPage: ExamConfigurationPage;
  accessGovernancePage: AccessGovernancePage;
};

/**
 * Extends the Playwright test object with the DVS page objects.
 * Browser/context/page setup stays with Playwright; only page objects are added.
 */
export const test = base.extend<PageFixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  setPasswordPage: async ({ page }, use) => {
    await use(new SetPasswordPage(page));
  },
  shellPage: async ({ page }, use) => {
    await use(new AuthenticatedShellPage(page));
  },
  examConfigurationPage: async ({ page }, use) => {
    await use(new ExamConfigurationPage(page));
  },
  accessGovernancePage: async ({ page }, use) => {
    await use(new AccessGovernancePage(page));
  },
});

export { expect };

/**
 * Opens the app and guarantees an authenticated Admin session.
 * Reuses the stored setup session when present, otherwise signs in through the UI.
 * Skips clearly when the environment URL or Admin credentials are absent.
 */
export async function ensureAdminSession(page: Page, loginPage: LoginPage): Promise<void> {
  const baseUrl = process.env.WEB_APP_URL;
  test.skip(!baseUrl, "Set WEB_APP_URL to the approved DVS environment.");

  await page.goto(baseUrl!);
  if (await loginPage.emailInput.isVisible()) {
    const email = process.env.DVS_ADMIN_EMAIL;
    const password = process.env.DVS_ADMIN_PASSWORD;
    test.skip(!email || !password, "Set DVS_ADMIN_EMAIL and DVS_ADMIN_PASSWORD to run Admin checks.");
    await loginPage.signIn(email!, password!);
  }
  await expect(loginPage.examConfigurationButton).toBeVisible();
}
