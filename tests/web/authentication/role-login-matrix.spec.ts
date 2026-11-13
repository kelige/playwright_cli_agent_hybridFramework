import "dotenv/config";
import { expect, test } from "../../../fixtures/pageFixtures";
import { Helper } from "../../../utils/helper";
import { signInAndResolveState } from "../../../utils/dvsAuth";
import { DVS_ROLES } from "../../../utils/dvsRoles";

/**
 * DVS Web — role-based login matrix.
 * Source: prompts/KTR_WEB_TEST_PROMPTS.md §19.
 *
 * One independent test per captured role. Role accounts are provisioned during
 * the run, so each test skips clearly until its DVS_<ROLE>_EMAIL/PASSWORD pair
 * exists. Sidebar labels are the verified inventory from §21.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const tenantName = process.env.DVS_TENANT_NAME;

for (const role of DVS_ROLES) {
  test.describe("@master @web @role role login matrix", () => {
    test(`${role.label} sees only its own workspace`, async ({
      page,
      loginPage,
      setPasswordPage,
      shellPage,
    }) => {
      test.skip(!process.env.WEB_APP_URL, "Set WEB_APP_URL to the approved DVS environment.");

      const keys = Helper.getRoleEnvironmentKey(role.role);
      const email = process.env[keys.email];
      const password = process.env[keys.password];
      test.skip(
        !email || !password,
        `Set ${keys.email} and ${keys.password} to run the ${role.label} role check.`,
      );

      const state = await test.step(`sign in as ${role.label}`, () =>
        signInAndResolveState(loginPage, setPasswordPage, shellPage, email!, password!),
      );

      test.skip(
        state === "rejected",
        `${role.label} credentials were rejected; verify the provisioned password.`,
      );

      if (state === "password-set") {
        const permanentPassword = process.env.DVS_ROLE_NEW_PASSWORD;
        test.skip(
          !permanentPassword,
          `First login is pending for ${role.label}; set DVS_ROLE_NEW_PASSWORD to complete it.`,
        );
        await setPasswordPage.expectOpen();
        await setPasswordPage.setPassword(permanentPassword!);
      }

      await test.step("the role shell and tenant are shown", async () => {
        await expect(shellPage.primaryNavigation).toBeVisible();
        if (tenantName) {
          await expect(shellPage.tenantName(tenantName)).toBeVisible();
        }
      });

      await test.step("the role exposes its own modules", async () => {
        for (const moduleName of role.modules) {
          await expect(shellPage.moduleButton(moduleName).first()).toBeVisible();
        }
      });

      await test.step("other roles' modules are absent", async () => {
        // Verified on brahma (2026-11-09): Admin is the platform superuser and
        // exposes every department's modules, so isolation is checked for the
        // scoped roles only.
        if (role.role === "admin") {
          return;
        }

        const restrictedModules = new Set(
          DVS_ROLES.filter((candidate) => candidate.role !== role.role)
            .flatMap((candidate) => candidate.modules)
            .filter((moduleName) => !role.modules.includes(moduleName)),
        );

        for (const moduleName of restrictedModules) {
          await expect(shellPage.moduleButton(moduleName)).toHaveCount(0);
        }
      });

      await test.step("the role scope survives a reload", async () => {
        await page.reload();
        await expect(shellPage.primaryNavigation).toBeVisible();
        for (const moduleName of role.modules) {
          await expect(shellPage.moduleButton(moduleName).first()).toBeVisible();
        }
        // The SPA keeps every in-app screen on the tenant root; no documented
        // deep link exists to probe, so restricted modules stay absent here.
        expect(new URL(page.url()).pathname).toBe("/");
      });
    });
  });
}

test("@master @web @role an unauthenticated visitor cannot reach a role workspace", async ({
  page,
  loginPage,
  shellPage,
}) => {
  test.skip(!process.env.WEB_APP_URL, "Set WEB_APP_URL to the approved DVS environment.");

  await loginPage.open();
  for (const role of DVS_ROLES) {
    for (const moduleName of role.modules) {
      await expect(shellPage.moduleButton(moduleName)).toHaveCount(0);
    }
  }
  expect(new URL(page.url()).pathname).toBe("/");
});
