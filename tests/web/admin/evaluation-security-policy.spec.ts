import "dotenv/config";
import { expect, test } from "../../../fixtures/pageFixtures";

/**
 * DVS Web - Admin evaluation security policy.
 * Source: prompts/KTR_WEB_TEST_PROMPTS.md section 18.
 *
 * Relaxes the evaluator session controls on the QA tenant so the secure-evaluation
 * flow can be exercised without strict device checks. State-changing, so it is gated
 * behind DVS_ALLOW_WRITES=true. The Admin password is entered only in the
 * re-authentication dialog and is never logged.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const RELAXED_CONTROLS = [
  "Keep camera on",
  "Require fullscreen",
  "Allow only one display",
  "Record incident clips",
  "Pause on security issues",
] as const;

test("@master @web @admin relaxes the evaluation security policy", async ({
  page,
  loginPage,
  accessGovernancePage,
}) => {
  test.skip(process.env.DVS_ALLOW_WRITES !== "true", "Set DVS_ALLOW_WRITES=true to change the policy.");
  const adminPassword = process.env.DVS_ADMIN_PASSWORD;
  test.skip(!adminPassword, "Set DVS_ADMIN_PASSWORD to complete re-authentication.");

  await test.step("0) sign in as Admin", async () => {
    await loginPage.open();
    await loginPage.signIn(process.env.DVS_ADMIN_EMAIL!, adminPassword!);
    await expect(loginPage.examConfigurationButton).toBeVisible();
  });

  await test.step("1) open Access governance > Evaluation security", async () => {
    await accessGovernancePage.openEvaluationSecurity();
  });

  await test.step("2) uncheck the strict evaluator controls", async () => {
    for (const control of RELAXED_CONTROLS) {
      await accessGovernancePage.setControl(control, false);
    }
  });

  await test.step("3) save with re-authentication", async () => {
    await accessGovernancePage.saveWithReauthentication(adminPassword!);
  });

  await test.step("4) the relaxed state persists after reload", async () => {
    await page.reload();
    await accessGovernancePage.openEvaluationSecurity();
    for (const control of RELAXED_CONTROLS) {
      await expect(accessGovernancePage.control(control)).not.toBeChecked();
    }
  });
});
