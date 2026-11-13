import { expect, type Locator, type Page } from "@playwright/test";

/**
 * DVS Exam configuration area.
 * Locators verified against the deployed build (2026-11-05):
 * tab groups "Configuration groups" (Sessions/Subjects/Papers) and
 * "Sessions configuration" (Degree / Programme, Scheme / Regulation, ...).
 */
export class ExamConfigurationPage {
  readonly page: Page;
  readonly openButton: Locator;
  readonly heading: Locator;

  // Sessions configuration -> Degree / Programme
  readonly degreeProgrammeTab: Locator;
  readonly addDegreeProgrammeButton: Locator;
  readonly degreeProgrammeDialog: Locator;
  readonly programmeCodeInput: Locator;
  readonly programmeNameInput: Locator;
  readonly createRecordButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.openButton = page.getByRole("button", {
      name: "Exam configuration",
      exact: true,
    });
    this.heading = page.getByRole("heading", {
      name: "Exam configuration",
      exact: true,
    });

    this.degreeProgrammeTab = page
      .getByRole("tablist", { name: "Sessions configuration" })
      .getByRole("tab", { name: "Degree / Programme", exact: true });
    this.addDegreeProgrammeButton = page.getByRole("button", {
      name: "Add Degree / Programme",
    });
    this.degreeProgrammeDialog = page
      .getByRole("dialog")
      .filter({ has: page.getByRole("heading", { name: "Add Degree / Programme" }) });
    this.programmeCodeInput = this.degreeProgrammeDialog.getByRole("textbox", {
      name: "Degree / Programme code",
      exact: true,
    });
    this.programmeNameInput = this.degreeProgrammeDialog.getByRole("textbox", {
      name: "Degree / Programme name",
      exact: true,
    });
    this.createRecordButton = this.degreeProgrammeDialog.getByRole("button", {
      name: "Create record",
      exact: true,
    });
  }

  async open(): Promise<void> {
    await this.openButton.click();
    await expect(this.heading).toBeVisible();
  }

  tabGroup(groupName: string): Locator {
    return this.page.getByRole("tablist", { name: groupName });
  }

  tab(groupName: string, tabName: string): Locator {
    return this.tabGroup(groupName).getByRole("tab", {
      name: tabName,
      exact: true,
    });
  }

  async openTab(groupName: string, tabName: string): Promise<void> {
    await this.tab(groupName, tabName).click();
  }

  async openDegreeProgrammeTab(): Promise<void> {
    await this.open();
    await this.degreeProgrammeTab.click();
  }

  /** Table row whose Code cell matches the given programme code. */
  programmeRow(code: string): Locator {
    return this.page
      .getByRole("row")
      .filter({ has: this.page.getByRole("cell", { name: code, exact: true }) });
  }

  addButton(name: string | RegExp): Locator {
    return this.page.getByRole("button", { name }).first();
  }

  /** Visible, non-hidden input controls inside the currently open form. */
  get visibleFormFields(): Locator {
    return this.page.locator("input:visible, select:visible, textarea:visible");
  }

  /** Visible controls that the browser itself marks as required. */
  get nativelyRequiredFormFields(): Locator {
    return this.page.locator(
      "input:visible:required, select:visible:required, textarea:visible:required, " +
        'input:visible[aria-required="true"], select:visible[aria-required="true"], ' +
        'textarea:visible[aria-required="true"]',
    );
  }
}
