import { expect } from "@playwright/test";
import type { AuthenticatedShellPage } from "../pages/AuthenticatedShellPage";
import type { LoginPage } from "../pages/LoginPage";
import type { SetPasswordPage } from "../pages/SetPasswordPage";

/**
 * Post-login state observed by the DVS sign-in page.
 * - shell: permanent password accepted, role workspace rendered.
 * - password-set: handover temporary password accepted, first-time set required.
 * - rejected: the application refused the credentials.
 */
export type DvsPostLoginState = "shell" | "password-set" | "rejected";

/**
 * Signs in and waits for one of the three observed post-login states.
 * Native form validation (empty/malformed email) never reaches this wait.
 * @param loginPage - Sign-in page object
 * @param setPasswordPage - First-time password screen page object
 * @param shellPage - Authenticated shell page object
 * @param email - Role email
 * @param password - Current password (temporary or permanent)
 * @returns The resolved post-login state
 */
export async function signInAndResolveState(
  loginPage: LoginPage,
  setPasswordPage: SetPasswordPage,
  shellPage: AuthenticatedShellPage,
  email: string,
  password: string,
): Promise<DvsPostLoginState> {
  await loginPage.open();
  await loginPage.signIn(email, password);

  const outcome = shellPage.primaryNavigation
    .or(setPasswordPage.heading)
    .or(loginPage.errorMessage);
  await expect(outcome).toBeVisible({ timeout: 20_000 });

  if (await setPasswordPage.heading.isVisible()) {
    return "password-set";
  }
  if (await shellPage.primaryNavigation.isVisible()) {
    return "shell";
  }
  return "rejected";
}
