import "dotenv/config";
import path from "node:path";
import { expect, test } from "../../../fixtures/pageFixtures";
import { DataProvider } from "../../../utils/DataReader";
import { signInAndResolveState } from "../../../utils/dvsAuth";
import { getDvsRoleDefinition } from "../../../utils/dvsRoles";

/**
 * DVS Web — data-driven login.
 * Source: prompts/KTR_WEB_TEST_PROMPTS.md §20.
 *
 * Rows come from testdata/dvs_logindata.json (same columns as the CSV/XLSX copy).
 * Credentials resolve from `.env` at runtime; no password is stored in the file.
 * Failure rows aimed at the primary Admin password are opt-in so repeated runs
 * never trip `failed_login_limit` (observed default 6).
 */
type DvsLoginRow = {
  testName: string;
  role: string;
  emailEnvKey: string;
  passwordEnvKey: string;
  email: string;
  password: string;
  firstLogin: boolean;
  expected: "success" | "failure";
  expectedLanding?: string;
  expectedMessage?: string;
  description?: string;
};

test.use({ storageState: { cookies: [], origins: [] } });

const rows = DataProvider.readJson(
  path.join(process.cwd(), "testdata", "dvs_logindata.json"),
) as DvsLoginRow[];

const observedRejection = /Unable to sign in|temporarily locked|Invalid email or password/;

for (const row of rows) {
  test(`@datadriven @web ${row.testName}`, async ({
    page,
    loginPage,
    setPasswordPage,
    shellPage,
  }) => {
    test.skip(!process.env.WEB_APP_URL, "Set WEB_APP_URL to the approved DVS environment.");

    const email = row.email || (row.emailEnvKey ? process.env[row.emailEnvKey] ?? "" : "");
    const password = row.password || (row.passwordEnvKey ? process.env[row.passwordEnvKey] ?? "" : "");

    if (row.expected === "success") {
      test.skip(
        !email || !password,
        `Set ${row.emailEnvKey} and ${row.passwordEnvKey} to run this row.`,
      );

      const state = await signInAndResolveState(
        loginPage,
        setPasswordPage,
        shellPage,
        email,
        password,
      );
      test.skip(state === "rejected", `${row.role} credentials were rejected; verify provisioning.`);

      if (state === "password-set") {
        const permanentPassword = process.env.DVS_ROLE_NEW_PASSWORD;
        test.skip(
          !permanentPassword,
          "Set DVS_ROLE_NEW_PASSWORD to complete the first-time password set.",
        );
        await setPasswordPage.expectOpen();
        await setPasswordPage.setPassword(permanentPassword!);
      }

      await expect(shellPage.primaryNavigation).toBeVisible();
      const [landingModule] = getDvsRoleDefinition(row.role).modules;
      await expect(shellPage.moduleButton(landingModule!).first()).toBeVisible();
      return;
    }

    // A literal password sent against the seeded Admin account is a deliberate
    // failed server attempt; keep it opt-in so the primary Admin is never locked.
    const attemptsAdminPassword = Boolean(row.password) && !row.passwordEnvKey && Boolean(row.emailEnvKey);
    test.skip(
      attemptsAdminPassword && process.env.DVS_ALLOW_CREDENTIAL_FAILURES !== "true",
      "Set DVS_ALLOW_CREDENTIAL_FAILURES=true to add Admin failed-login attempts.",
    );

    await loginPage.open();
    await loginPage.emailInput.fill(email);
    await loginPage.passwordInput.fill(password);
    await loginPage.signInButton.click();

    const emailValid = await loginPage.emailInput.evaluate(
      (element: HTMLInputElement) => element.checkValidity(),
    );

    if (emailValid && password) {
      await expect(loginPage.errorMessage).toBeVisible();
      await expect(loginPage.errorMessage).toHaveText(observedRejection);
    } else {
      // Native required/type validation blocks the submit before any server call.
      await expect(loginPage.errorMessage).toHaveCount(0);
    }

    await expect(loginPage.signInButton).toBeVisible();
    await expect(shellPage.primaryNavigation).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/");
  });
}
