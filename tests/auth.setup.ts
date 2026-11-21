import "dotenv/config";
import { expect, test as setup } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage";

const adminAuthFile = "playwright/.auth/admin.json";

/**
 * Authenticates the Admin account once and stores the session for reuse.
 * Runs as the `setup` project, which the chromium project depends on.
 * Skips clearly when the environment URL or Admin credentials are absent.
 */
setup("authenticate as Admin", async ({ page }) => {
  setup.skip(
    !process.env.WEB_APP_URL,
    "Set WEB_APP_URL, or run `npm run test:platform` to provision a university.",
  );
  setup.skip(
    !process.env.DVS_ADMIN_EMAIL || !process.env.DVS_ADMIN_PASSWORD,
    "Run `npm run test:platform` to provision a university and write its Admin credentials.",
  );

  const loginPage = new LoginPage(page);
  await loginPage.open();
  await loginPage.signIn(process.env.DVS_ADMIN_EMAIL!, process.env.DVS_ADMIN_PASSWORD!);

  // First login must set a permanent password before a session can be stored.
  const setPasswordHeading = page.getByRole("heading", { name: "Set your password", exact: true });
  if (await setPasswordHeading.isVisible()) {
    setup.info().skip(true, "Admin first login is pending; run `npm run test:first-login` once, then retry.");
  }

  await expect(loginPage.examConfigurationButton).toBeVisible();

  await page.context().storageState({ path: adminAuthFile });
});
