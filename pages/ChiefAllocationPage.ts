import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Chief Examiner "Allocation engine" workspace.
 * Locators verified against the brahma tenant on 2026-11-13.
 */
export class ChiefAllocationPage {
  readonly page: Page;
  readonly allocationEngineButton: Locator;
  readonly batchSelect: Locator;
  readonly packetSelect: Locator;
  readonly allocateButton: Locator;
  readonly allocationDialog: Locator;

  constructor(page: Page) {
    this.page = page;
    this.allocationEngineButton = page.getByRole("navigation", { name: "Primary navigation" })
      .getByRole("button", { name: "Allocation engine", exact: true });
    this.batchSelect = page.locator("select").nth(0);
    this.packetSelect = page.locator("select").nth(1);
    this.allocateButton = page.getByRole("button", { name: "Allocate packet", exact: true });
    this.allocationDialog = page.getByRole("dialog").filter({ hasText: "Packet allocated" });
  }

  async open(): Promise<void> {
    await this.allocationEngineButton.click();
    await expect(this.page.getByRole("heading", { name: "Allocation engine", exact: true })).toBeVisible();
  }

  /** Closes the role guidance dialog when the shell renders it. */
  async dismissGuidance(): Promise<void> {
    const close = this.page.getByRole("dialog").getByRole("button", { name: "Close", exact: true });
    if (await close.isVisible().catch(() => false)) {
      await close.click();
    }
  }

  /** Selects the chief's own examiner batch. */
  async selectBatch(): Promise<void> {
    const option = this.batchSelect.locator("option").filter({ hasNotText: "Select batch" }).first();
    await expect(option).toHaveCount(1);
    await this.batchSelect.selectOption({ label: await option.innerText() });
  }

  /**
   * Selects the batch that holds this run's packet.
   * @param runId - Run identifier embedded in the packet's paper code
   */
  async selectBatchForRun(runId: string): Promise<void> {
    const options = this.batchSelect.locator("option").filter({ hasNotText: "Select batch" });
    const count = await options.count();
    for (let index = 0; index < count; index += 1) {
      const label = await options.nth(index).innerText();
      await this.batchSelect.selectOption({ label });
      const packet = this.packetSelect.locator("option").filter({ hasText: runId });
      if (await packet.count()) return;
    }
  }

  /** Selects the one ready evaluator packet in the batch. */
  async selectReadyPacket(): Promise<void> {
    const option = this.packetSelect.locator("option").filter({ hasNotText: "Select packet" }).first();
    await expect(option).toHaveCount(1);
    await this.packetSelect.selectOption({ label: await option.innerText() });
  }

  /**
   * Selects this run's packet.
   * @param runId - Run identifier embedded in the paper code
   */
  async selectReadyPacketForRun(runId: string): Promise<void> {
    const option = this.packetSelect.locator("option").filter({ hasText: runId }).first();
    await expect(option).toHaveCount(1);
    await this.packetSelect.selectOption({ label: await option.innerText() });
  }

  /** Evaluator card inside Choose evaluator; matched by the displayed evaluator name. */
  evaluatorTile(name: string): Locator {
    return this.page.locator("main").getByText(name, { exact: true }).first();
  }

  /** First available evaluator card, independent of the tenant's display name. */
  firstAvailableEvaluator(): Locator {
    return this.page.locator(".ca-availability.available").first();
  }

  /**
   * Allocates the selected packet to the evaluator.
   * @param evaluatorName - Optional display name; the first available card is used when omitted
   */
  async allocate(evaluatorName?: string): Promise<void> {
    if (evaluatorName) {
      await this.evaluatorTile(evaluatorName).click();
    } else {
      await this.firstAvailableEvaluator().click();
    }
    await expect(this.allocateButton).toBeEnabled();
    await this.allocateButton.click();
    await expect(this.allocationDialog).toBeVisible();
    await this.allocationDialog.getByRole("button", { name: "Stay here", exact: true }).click();
    await expect(this.allocationDialog).toBeHidden();
  }

  /** True when the batch still exposes an unallocated packet. */
  async hasReadyPacket(runId?: string): Promise<boolean> {
    const options = runId
      ? this.packetSelect.locator("option").filter({ hasText: runId })
      : this.packetSelect.locator("option").filter({ hasNotText: "Select packet" });
    return (await options.count()) > 0;
  }
}
