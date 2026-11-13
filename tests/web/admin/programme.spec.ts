import "dotenv/config";
import { ensureAdminSession, expect, test } from "../../../fixtures/pageFixtures";
import { Helper } from "../../../utils/helper";

/**
 * DVS Admin — create Degree / Programme (prompts/DVS_WEB_PRPMPT.md #5).
 *
 * State-changing spec. Gated behind DVS_ENV + DVS_ALLOW_WRITES=true so the live
 * staging environment is never written without explicit approval (DVS-MCP-CONTEXT §5.4).
 * Locators verified against the deployed build on 2026-11-05.
 */
const writesApproved =
  !!process.env.DVS_ENV && process.env.DVS_ALLOW_WRITES === "true";

test.describe("@master @web @admin @programme Degree / Programme creation", () => {
  test.skip(
    !writesApproved,
    "State-changing spec. Set DVS_ENV and DVS_ALLOW_WRITES=true to run it (DVS-MCP-CONTEXT §5.4).",
  );

  test("creates a Degree / Programme and persists it", async ({ page, loginPage, examConfigurationPage }) => {
    const academic = Helper.getAcademicConfigurationData();
    // Unique code per run so repeat executions do not collide (DVS-AUTO-BCA stays the base).
    const uniqueCode = Helper.getDvsTestRunId().replace("DVS-RUN-", "DVS-AUTO-");

    await test.step("open Exam configuration > Degree / Programme", async () => {
      await ensureAdminSession(page, loginPage);
      await examConfigurationPage.openDegreeProgrammeTab();
      await expect(examConfigurationPage.degreeProgrammeTab).toBeVisible();
    });

    await test.step("open the Add form and verify required controls", async () => {
      await examConfigurationPage.addDegreeProgrammeButton.click();
      await expect(examConfigurationPage.degreeProgrammeDialog).toBeVisible();
      await expect(examConfigurationPage.programmeCodeInput).toHaveAttribute("required", "");
      await expect(examConfigurationPage.programmeNameInput).toHaveAttribute("required", "");
    });

    await test.step("create the programme", async () => {
      await examConfigurationPage.programmeCodeInput.fill(uniqueCode);
      await examConfigurationPage.programmeNameInput.fill(academic.programmeName);
      await examConfigurationPage.createRecordButton.click();
    });

    await test.step("the new programme appears in the list", async () => {
      await expect(examConfigurationPage.programmeRow(uniqueCode)).toBeVisible();
    });

    await test.step("the programme persists after reload", async () => {
      await page.reload();
      await examConfigurationPage.openDegreeProgrammeTab();
      await expect(examConfigurationPage.programmeRow(uniqueCode)).toBeVisible();
    });
  });

  test("blocks creation when required fields are empty", async ({ page, loginPage, examConfigurationPage }) => {
    await ensureAdminSession(page, loginPage);
    await examConfigurationPage.openDegreeProgrammeTab();
    await examConfigurationPage.addDegreeProgrammeButton.click();
    await expect(examConfigurationPage.degreeProgrammeDialog).toBeVisible();

    await examConfigurationPage.createRecordButton.click();

    // Native required validation keeps the dialog open and creates nothing.
    await expect(examConfigurationPage.degreeProgrammeDialog).toBeVisible();
    await expect(examConfigurationPage.programmeCodeInput).toHaveAttribute("required", "");
  });
});
