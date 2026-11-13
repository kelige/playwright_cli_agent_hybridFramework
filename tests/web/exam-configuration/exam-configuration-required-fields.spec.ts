import "dotenv/config";
import { ensureAdminSession, expect, test } from "../../../fixtures/pageFixtures";
import type { LoginPage } from "../../../pages/LoginPage";

const roleAccounts = [
  { role: "Admin", emailKey: "DVS_ADMIN_EMAIL", passwordKey: "DVS_ADMIN_PASSWORD" },
  { role: "Chairman", emailKey: "DVS_CHAIRMAN_EMAIL", passwordKey: "DVS_CHAIRMAN_PASSWORD" },
] as const;

const adminForms = [
  { group: "Sessions configuration", tab: "Degree / Programme", add: /Add Degree \/ Programme/i, minimumRequired: 2, minimumFields: 2 },
  { group: "Sessions configuration", tab: "Scheme / Regulation", add: /Add Scheme \/ Regulation/i, minimumRequired: 1, minimumFields: 3 },
  { group: "Sessions configuration", tab: "Academic years", add: /Add Academic Year/i, minimumRequired: 1, minimumFields: 2 },
  { group: "Sessions configuration", tab: "Exam sessions", add: /Add Exam Session/i, minimumRequired: 3, minimumFields: 3 },
  { group: "Configuration groups", tab: "Subjects", add: /Add Subject/i, minimumRequired: 5, minimumFields: 5 },
  { group: "Configuration groups", tab: "Papers", add: /Add Paper/i, minimumRequired: 1, minimumFields: 12 },
] as const;

async function signInWithRole(
  loginPage: LoginPage,
  role: string,
  emailKey: string,
  passwordKey: string,
): Promise<void> {
  const email = process.env[emailKey];
  const password = process.env[passwordKey];
  test.skip(!process.env.WEB_APP_URL, "Set WEB_APP_URL to the approved DVS environment.");
  test.skip(!email || !password, `Set ${emailKey} and ${passwordKey} to run ${role} checks.`);

  await loginPage.open();
  await loginPage.signIn(email!, password!);
}

for (const account of roleAccounts) {
  test(`@master @web @${account.role.toLowerCase()} can access paper configuration`, async ({ page, loginPage, examConfigurationPage }) => {
    if (account.role === "Admin") {
      await ensureAdminSession(page, loginPage);
    } else {
      await signInWithRole(loginPage, account.role, account.emailKey, account.passwordKey);
    }

    await examConfigurationPage.open();
    await expect(page.getByRole("tab", { name: "Papers", exact: true })).toBeVisible();
  });
}

for (const formCase of adminForms) {
  test(`@master @web @admin ${formCase.tab} marks required controls`, async ({ loginPage, examConfigurationPage }) => {
    await ensureAdminSession(examConfigurationPage.page, loginPage);
    await examConfigurationPage.open();
    await examConfigurationPage.openTab(formCase.group, formCase.tab);

    const addButton = examConfigurationPage.addButton(formCase.add);
    test.skip(!(await addButton.count()), `${formCase.tab} add form is unavailable in this deployment.`);
    test.skip(!(await addButton.isEnabled()), `${formCase.tab} form is disabled by current prerequisites.`);
    await addButton.click();

    expect(await examConfigurationPage.visibleFormFields.count()).toBeGreaterThanOrEqual(formCase.minimumFields);
    expect(await examConfigurationPage.nativelyRequiredFormFields.count()).toBeGreaterThanOrEqual(formCase.minimumRequired);
  });
}

test("@master @web @admin marking scheme requires paper and title", async ({ page, loginPage }) => {
  await ensureAdminSession(page, loginPage);
  await page.getByRole("button", { name: "Marking schemes", exact: true }).click();
  await page.getByRole("button", { name: "New scheme version", exact: true }).click();

  expect(await page.getByRole("combobox", { name: "Paper", exact: true }).evaluate((element) => (element as HTMLSelectElement).required)).toBe(true);
  expect(await page.getByRole("textbox", { name: "Title", exact: true }).evaluate((element) => (element as HTMLInputElement).required)).toBe(true);
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
});

test("@master @web @admin adding user requires re-authentication", async ({ page, loginPage }) => {
  await ensureAdminSession(page, loginPage);
  await page.getByRole("button", { name: "Access governance", exact: true }).click();
  await page.getByRole("button", { name: "Access", exact: true }).click();
  await page.getByRole("button", { name: "Add user", exact: true }).click();

  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(page.getByLabel("Authenticator code")).toBeVisible();
});
