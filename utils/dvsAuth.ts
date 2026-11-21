import { expect } from "@playwright/test";
import type { AuthenticatedShellPage } from "../pages/AuthenticatedShellPage";
import type { LoginPage } from "../pages/LoginPage";
import type { SetPasswordPage } from "../pages/SetPasswordPage";

/**
 * Post-login state observed by the DVS sign-in page.
 * - shell: permanent password accepted, role workspace rendered.
 * - password-set: handover temporary password accepted, first-time set required.
 * - face-enrollment: credentials accepted, face registration required before the shell.
 * - face-verification: face already enrolled, a quick face check is required before the shell.
 * - rejected: the application refused the credentials.
 */
export type DvsPostLoginState =
  | "shell"
  | "password-set"
  | "face-enrollment"
  | "face-verification"
  | "rejected";

/**
 * Signs in and waits for one of the four observed post-login states.
 * Native form validation (empty/malformed email) never reaches this wait.
 * @param loginPage - Sign-in page object
 * @param setPasswordPage - First-time password screen page object
 * @param shellPage - Authenticated shell page object
 * @param email - Role email
 * @param password - Current password (temporary or permanent)
 * @param baseUrl - Optional tenant URL; used when `WEB_APP_URL` is not set yet
 * @returns The resolved post-login state
 */
export async function signInAndResolveState(
  loginPage: LoginPage,
  setPasswordPage: SetPasswordPage,
  shellPage: AuthenticatedShellPage,
  email: string,
  password: string,
  baseUrl?: string,
): Promise<DvsPostLoginState> {
  await loginPage.open(baseUrl);
  await loginPage.signIn(email, password);

  const faceEnrollment = loginPage.page.getByRole("region", { name: /Register your face/i });
  const faceVerification = loginPage.page.getByRole("region", { name: /Verify your face/i });
  const outcome = shellPage.primaryNavigation
    .or(setPasswordPage.heading)
    .or(faceEnrollment)
    .or(faceVerification)
    .or(loginPage.errorMessage);
  await expect(outcome).toBeVisible({ timeout: 20_000 });

  if (await setPasswordPage.heading.isVisible()) {
    return "password-set";
  }
  if (await faceEnrollment.isVisible()) {
    return "face-enrollment";
  }
  if (await faceVerification.isVisible()) {
    return "face-verification";
  }
  if (await shellPage.primaryNavigation.isVisible()) {
    return "shell";
  }
  return "rejected";
}
