import "dotenv/config";
import { expect, test } from "../../../fixtures/pageFixtures";

/**
 * DVS Web — login, handover temporary password, first-time password set.
 * Source: prompts/KTR_WEB_TEST_PROMPTS.md §3.
 *
 * The first-login spec consumes the one-time credential, so it is serial and
 * runs without the stored Admin session (`--project=first-login`). Locators
 * verified against the kim tenant on 2026-11-06.
 */
const adminEmail = process.env.DVS_ADMIN_EMAIL;
const tempPassword = process.env.DVS_ADMIN_TEMP_PASSWORD;
const permanentPassword = process.env.DVS_ROLE_NEW_PASSWORD;
const tenantName = process.env.DVS_TENANT_NAME;
// Temporary-password reuse adds a failed attempt for the Admin account, so it is opt-in.
const verifyTempReuse = process.env.DVS_VERIFY_TEMP_REUSE === "true";

test.describe("@master @web @authentication login and first-time password set", () => {
  test.describe.configure({ mode: "serial" });

  test("1) login page exposes the documented controls @smoke @sanity", async ({ loginPage }) => {
    test.skip(!process.env.WEB_APP_URL, "Set WEB_APP_URL to the approved DVS environment.");

    await loginPage.open();
    await expect(
      loginPage.page.getByRole("heading", { name: "Welcome back", exact: true }),
    ).toBeVisible();
    await expect(loginPage.subtitle).toBeVisible();
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.emailInput).toHaveAttribute("required", "");
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.passwordInput).toHaveAttribute("required", "");
    await expect(loginPage.signInButton).toBeVisible();
    await expect(loginPage.passkeyButton).toBeVisible();
  });

  test("2) replaces the handover temporary password and lands in the shell", async ({
    page,
    loginPage,
    setPasswordPage,
    shellPage,
  }) => {
    test.skip(!process.env.WEB_APP_URL, "Set WEB_APP_URL to the approved DVS environment.");
    test.skip(
      !adminEmail || !tempPassword || !permanentPassword,
      "Set DVS_ADMIN_EMAIL, DVS_ADMIN_TEMP_PASSWORD and DVS_ROLE_NEW_PASSWORD to run the first-login flow.",
    );

    await test.step("sign in with the handover temporary password", async () => {
      await loginPage.open();
      await loginPage.signIn(adminEmail!, tempPassword!);
    });

    await test.step("the set-password screen replaces the one-time credential", async () => {
      const firstLoginPending = await setPasswordPage.heading
        .waitFor({ state: "visible", timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      test.skip(
        !firstLoginPending,
        "First login already completed for this account; DVS_ADMIN_TEMP_PASSWORD is no longer valid.",
      );

      await setPasswordPage.expectOpen();
      await expect(setPasswordPage.requirementsHeading).toBeVisible();
      await expect(page.getByText("Minimum 12 characters", { exact: true })).toBeVisible();
      await expect(
        page.getByText("No continuous sequence or repeating characters (e.g. 123, abc, aaa)", {
          exact: true,
        }),
      ).toBeVisible();
    });

    await test.step("set a strong password twice", async () => {
      await setPasswordPage.setPassword(permanentPassword!);
    });

    await test.step("the authenticated shell is shown", async () => {
      await expect(shellPage.mainHeading).toBeVisible();
      if (tenantName) {
        await expect(shellPage.tenantName(tenantName)).toBeVisible();
      }
      await expect(shellPage.primaryNavigation).toBeVisible();
      await expect(shellPage.languageSelector).toBeVisible();
      await expect(shellPage.notificationsButton).toBeVisible();
      await expect(shellPage.signOutButton).toBeVisible();
      await expect(shellPage.accountSettingsButton).toBeVisible();
      await expect(setPasswordPage.heading).toHaveCount(0);
    });

    await test.step("the session survives a reload", async () => {
      await page.reload();
      await expect(shellPage.mainHeading).toBeVisible();
    });
  });

  test("3) rejects the temporary password after it was replaced", async ({ loginPage }) => {
    test.skip(!process.env.WEB_APP_URL, "Set WEB_APP_URL to the approved DVS environment.");
    test.skip(
      !verifyTempReuse,
      "Set DVS_VERIFY_TEMP_REUSE=true to check temporary-password reuse (adds one failed attempt).",
    );
    test.skip(
      !adminEmail || !tempPassword,
      "Set DVS_ADMIN_EMAIL and DVS_ADMIN_TEMP_PASSWORD to check temporary-password reuse.",
    );

    await loginPage.open();
    await loginPage.signIn(adminEmail!, tempPassword!);

    await expect(loginPage.errorMessage).toBeVisible();
    await expect(loginPage.errorMessage).toHaveText(/Unable to sign in|temporarily locked/);
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.page.getByRole("heading", { name: "Set your password" })).toHaveCount(0);
  });
});
