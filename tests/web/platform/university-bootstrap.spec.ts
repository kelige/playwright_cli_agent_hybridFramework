import "dotenv/config";
import { test, expect } from "@playwright/test";
import {
  PlatformSession,
  nextUniversityNumber,
  platformBaseUrl,
  provisionUniversity,
  type PlatformUniversityHandover,
} from "../../../utils/platformClient";
import {
  clearTenantRuntime,
  completeUniversityAdminFirstLogin,
  persistUniversity,
  type ProvisionedUniversity,
} from "../../../utils/tenantBootstrap";

/**
 * Platform Admin bootstrap — creates a brand-new university on every run.
 *
 * The control plane exposes the same operation the console's **New university**
 * action performs, so the university, its administrator and the one-time
 * handover are created without a manual step:
 *   POST /api/v1/enterprise/tenants  ->  tenant + temporary_password + hostname
 *
 * The handover is consumed immediately: the new administrator signs in with the
 * one-time password, replaces it, and only the permanent credentials and the
 * tenant URL are persisted for the rest of the workflow.
 *
 * Source: prompts/KTR_WEB_TEST_PROMPTS.md §0.1.
 */

const platformUrl = platformBaseUrl();
const platformEmail = process.env.PLATFORM_ADMIN_EMAIL ?? "";
const platformPassword = process.env.PLATFORM_ADMIN_PASSWORD ?? "";
const permanentPassword =
  process.env.DVS_ROLE_NEW_PASSWORD || process.env.DVS_UNIVERSITY_ADMIN_PASSWORD || "";
const baseDomain = (process.env.PLATFORM_BASE_DOMAIN ?? "").trim();

/**
 * Recognisable, sequential university naming.
 *
 * `Automation testing -1`, `-2`, `-3` … so the console is easy to scan. The code
 * and administrator mailbox derive from the same number, which keeps every run
 * unique without reading back the runtime keys this bootstrap writes.
 * @param number - Sequence number resolved from the live tenant list
 */
function runNaming(number: number) {
  return {
    number,
    name: `Automation testing -${number}`,
    code: `automation-testing-${number}`,
    adminEmail: `automation.testing.${number}@example.com`,
  };
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Platform Admin — provision a new university @master @platform @end-to-end", () => {
  test.skip(!platformUrl, "Set PLATFORM_URL to the platform console.");
  test.skip(
    !platformEmail || !platformPassword,
    "Set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD.",
  );
  test.skip(!baseDomain, "Set PLATFORM_BASE_DOMAIN so the tenant URL can be verified.");
  test.skip(!permanentPassword, "Set DVS_ROLE_NEW_PASSWORD for the new administrator.");
  test.skip(
    process.env.DVS_ALLOW_WRITES !== "true",
    "Set DVS_ALLOW_WRITES=true to provision a university.",
  );

  test.describe.configure({ mode: "serial", timeout: 5 * 60_000 });

  test("provisions the university, completes the Admin handover and stores the runtime", async () => {
    let naming = runNaming(0);
    let handover: PlatformUniversityHandover | undefined;
    let university: ProvisionedUniversity | undefined;

    await test.step("1) clear the previous university and sign in to the platform", async () => {
      // Removes WEB_APP_URL, the old Admin and every role login, keeping the
      // platform, browser and database configuration untouched.
      clearTenantRuntime();

      const session = await PlatformSession.login(platformEmail, platformPassword);
      try {
        expect(session.loginResponse.status(), "platform login").toBe(200);
        expect(platformUrl, "platform origin").toMatch(/^https?:\/\//);
        naming = runNaming(await nextUniversityNumber(session));
      } finally {
        await session.dispose();
      }
    });

    await test.step("2) create a new university and capture the administrator handover", async () => {
      const session = await PlatformSession.login(platformEmail, platformPassword);
      try {
        handover = await provisionUniversity(session, {
          name: naming.name,
          code: naming.code,
          adminEmail: naming.adminEmail,
          adminFirstName: "Automation",
          adminLastName: "University Admin",
          plan: process.env.DVS_UNIVERSITY_PLAN || "enterprise",
        });
      } finally {
        await session.dispose();
      }

      expect(handover.tenantId, "tenant id").not.toBe("");
      expect(handover.tenantUrl, "tenant URL").toBe(`https://${handover.hostname}`);
      expect(handover.adminEmail, "administrator email").toContain("@");
      expect(handover.temporaryPassword, "one-time administrator password").not.toBe("");

      test.info().annotations.push({
        type: "university",
        description: `${handover.name}: ${handover.tenantUrl}`,
      });
      console.log(`\nNEW UNIVERSITY: ${handover.name}\n  URL: ${handover.tenantUrl}\n`);
    });

    await test.step("3) complete the administrator first login with the handover password", async () => {
      university = await completeUniversityAdminFirstLogin(handover!, permanentPassword);
      expect(university.adminEmail).toBe(handover!.adminEmail);
    });

    await test.step("4) persist only the tenant URL and the permanent credentials", async () => {
      persistUniversity(university!, permanentPassword);

      const env = await import("node:fs").then((fs) =>
        fs.readFileSync(".env", "utf-8"),
      );
      expect(env, "the temporary password must never be persisted").not.toContain(
        handover!.temporaryPassword,
      );
      expect(env).toContain(`WEB_APP_URL=${university!.tenantUrl}`);
      expect(env).toContain(`DVS_ADMIN_EMAIL=${university!.adminEmail}`);
    });

    console.log("✅ New university provisioned and its Admin password replaced");
  });
});
