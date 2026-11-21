import "dotenv/config";
import { expect, type Page } from "@playwright/test";
import { AuthenticatedShellPage } from "../pages/AuthenticatedShellPage";
import { LoginPage } from "../pages/LoginPage";
import { SetPasswordPage } from "../pages/SetPasswordPage";
import { signInAndResolveState } from "./dvsAuth";
import { Helper } from "./helper";

/** Credentials resolved for one role of the current run. */
export type RoleCredentials = { email: string; password: string };

/**
 * Resolves a role login from `.env`. The workflow writes these after provisioning,
 * so a test-case run never needs credentials supplied up front.
 * @param role - Role key from the role inventory
 */
export function roleCredentials(role: string): RoleCredentials {
  const keys = Helper.getRoleEnvironmentKey(role);
  return {
    email: process.env[keys.email]?.trim() ?? "",
    password: process.env[keys.password] ?? "",
  };
}

/**
 * Signs in as a role and returns the resolved post-login state.
 * A first-login password screen is completed with the role's permanent password.
 * @param page - Playwright page
 * @param role - Role key from the role inventory
 * @returns Resolved post-login state (`shell` for a normal run)
 */
export async function signInRole(
  page: Page,
  role: string,
): Promise<"shell" | "face-enrollment" | "face-verification"> {
  const { email, password } = roleCredentials(role);
  if (!email || !password) {
    throw new Error(
      `No credentials for ${role}. Run \`npm run test:platform\` so the workflow provisions the role.`,
    );
  }

  const loginPage = new LoginPage(page);
  const setPasswordPage = new SetPasswordPage(page);
  const shellPage = new AuthenticatedShellPage(page);

  const state = await signInAndResolveState(loginPage, setPasswordPage, shellPage, email, password);
  if (state === "rejected") throw new Error(`The ${role} credentials were rejected for ${email}.`);
  if (state === "password-set") await setPasswordPage.setPassword(password);

  const faceRegion = page.getByRole("region", { name: /(Register|Verify) your face/i });
  if (state === "face-enrollment" || state === "face-verification") return state;
  if (await faceRegion.isVisible().catch(() => false)) return "face-verification";
  await expect(shellPage.primaryNavigation).toBeVisible({ timeout: 30_000 });
  return "shell";
}

/** Skips the file when no tenant is configured. */
export function tenantReady(): boolean {
  return Boolean(process.env.WEB_APP_URL);
}
