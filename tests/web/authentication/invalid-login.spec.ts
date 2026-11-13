import "dotenv/config";
import { expect, test } from "../../../fixtures/pageFixtures";

/**
 * DVS Web — invalid login.
 * Source: prompts/KTR_WEB_TEST_PROMPTS.md §4.
 *
 * Observed on the brahma tenant (2026-11-06):
 * - Malformed/empty credentials are blocked by native form validation; no server call.
 * - Unknown accounts return "Unable to sign in. Check your email and password, or
 *   contact your administrator." — the build does not use the older "Invalid email
 *   or password" wording, so the assertion follows the deployed message.
 * This file runs anonymously: the stored Admin session is cleared for every test.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const signInError =
  "Unable to sign in. Check your email and password, or contact your administrator.";

const unknownAccounts = [
  "dvs.unknown.user@example.invalid",
  "dvs.unknown.other@example.invalid",
];

test.describe("@master @web @authentication invalid login", () => {
  test.beforeEach(async ({ loginPage }) => {
    test.skip(!process.env.WEB_APP_URL, "Set WEB_APP_URL to the approved DVS environment.");
    await loginPage.open();
    await expect(loginPage.emailInput).toBeVisible();
  });

  test("malformed email is rejected by native validation", async ({
    page,
    loginPage,
    shellPage,
  }) => {
    await loginPage.emailInput.fill("not-an-email");
    await loginPage.passwordInput.fill("DummyPassword123!");
    await loginPage.signInButton.click();

    expect(await loginPage.emailInput.evaluate((el: HTMLInputElement) => el.checkValidity())).toBe(false);
    await expect(loginPage.errorMessage).toHaveCount(0);
    await expect(loginPage.emailInput).toHaveValue("not-an-email");
    await expect(loginPage.signInButton).toBeVisible();
    await expect(shellPage.mainHeading).toHaveCount(0);
    await expect(shellPage.primaryNavigation).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("empty email and password never reach authentication", async ({
    page,
    loginPage,
    shellPage,
  }) => {
    await loginPage.signInButton.click();
    // The submit briefly renders a disabled "Please wait…" control; wait for the settled form.
    await expect(loginPage.signInButton).toBeVisible();

    expect(await loginPage.emailInput.evaluate((el: HTMLInputElement) => el.checkValidity())).toBe(false);
    expect(await loginPage.passwordInput.evaluate((el: HTMLInputElement) => el.checkValidity())).toBe(false);
    await expect(loginPage.emailInput).toHaveValue("");
    await expect(loginPage.passwordInput).toHaveValue("");
    await expect(loginPage.errorMessage).toHaveCount(0);
    await expect(shellPage.mainHeading).toHaveCount(0);
    await expect(shellPage.primaryNavigation).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/");
  });

  for (const email of unknownAccounts) {
    test(`unknown account ${email} is rejected without revealing existence`, async ({
      page,
      loginPage,
      shellPage,
    }) => {
      await loginPage.signIn(email, "DummyPassword123!");

      await expect(loginPage.errorMessage).toBeVisible();
      await expect(loginPage.errorMessage).toHaveText(signInError);
      await expect(loginPage.signInButton).toBeVisible();
      await expect(shellPage.mainHeading).toHaveCount(0);
      await expect(shellPage.primaryNavigation).toHaveCount(0);
      expect(new URL(page.url()).pathname).toBe("/");
    });
  }
});
