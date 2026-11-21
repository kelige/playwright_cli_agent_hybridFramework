import { expect, type Locator, type Page } from "@playwright/test";
import { PROVISION_TENANT_PATH } from "../api/endpoints/platformRoutes";

/** Handover shown immediately after a university is provisioned. */
export type PlatformHandover = {
  administratorEmail: string;
  temporaryPassword: string;
  tenantUrl: string;
};

/**
 * Platform control-plane console (`PLATFORM_URL`).
 *
 * The platform reuses the DVS session auth, but the console shell is separate
 * from a university tenant. Locators below are the verified console labels:
 * nav group "Platform" -> item "Universities"; view "University management";
 * actions "New university" / "Provision university"; handover
 * "Administrator handover", "Copy temporary password", "Open university workspace".
 *
 * The temporary password is deliberately never logged or persisted by this class.
 */
export class PlatformAdminPage {
  readonly page: Page;

  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;
  readonly universityManagementHeading: Locator;
  readonly universitiesNavItem: Locator;
  readonly newUniversityButton: Locator;
  readonly administratorHandover: Locator;
  readonly openUniversityWorkspaceButton: Locator;
  readonly temporaryPasswordCopyButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.locator('input[type="email"]').first();
    this.passwordInput = page.locator('input[type="password"]').first();
    this.signInButton = page.getByRole("button", { name: /sign in/i }).first();
    this.universityManagementHeading = page.getByText("University management", { exact: true });
    this.universitiesNavItem = page
      .getByRole("button", { name: "Universities", exact: true })
      .or(page.getByRole("link", { name: "Universities", exact: true }))
      .first();
    this.newUniversityButton = page.getByRole("button", { name: /new university/i }).first();
    this.administratorHandover = page.getByText("Administrator handover", { exact: true });
    this.openUniversityWorkspaceButton = page
      .getByRole("button", { name: /open university workspace/i })
      .or(page.getByRole("link", { name: /open university workspace/i }))
      .first();
    this.temporaryPasswordCopyButton = page
      .getByRole("button", { name: /copy temporary password/i })
      .first();
  }

  /** Opens the platform console and signs in as the platform administrator. */
  async login(email: string, password: string): Promise<void> {
    await this.page.goto(process.env.PLATFORM_URL ?? "", { waitUntil: "domcontentloaded" });
    await expect(this.emailInput.or(this.universityManagementHeading)).toBeVisible({
      timeout: 30_000,
    });

    if (await this.emailInput.isVisible()) {
      await this.emailInput.fill(email);
      await this.passwordInput.fill(password);
      await this.signInButton.click();
    }

    await expect(this.universitiesNavItem.or(this.universityManagementHeading)).toBeVisible({
      timeout: 30_000,
    });
  }

  /** Opens Platform -> Universities. */
  async openUniversities(): Promise<void> {
    if (!(await this.universityManagementHeading.isVisible().catch(() => false))) {
      await this.universitiesNavItem.click();
    }
    await expect(this.universityManagementHeading).toBeVisible({ timeout: 30_000 });
  }

  /**
   * Resolves with the create-tenant response. Call this before instructing the
   * tester to create the university so the response is never missed.
   * @param timeoutMs - How long the tester has to provision the university
   * @returns Parsed response body
   */
  async waitForProvisionResponse(timeoutMs: number): Promise<Record<string, unknown>> {
    const response = await this.page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        candidate.url().endsWith(PROVISION_TENANT_PATH) &&
        candidate.status() >= 200 &&
        candidate.status() < 300,
      { timeout: timeoutMs },
    );
    return (await response.json()) as Record<string, unknown>;
  }

  /**
   * Fallback when the provision response omits the handover values: reads the
   * visible handover sheet. Call after `administratorHandover` is visible.
   */
  async readVisibleHandover(): Promise<PlatformHandover> {
    await expect(this.administratorHandover).toBeVisible({ timeout: 30_000 });
    const body = await this.page.locator("body").innerText();

    // The sheet may render the credentials as readonly inputs rather than text.
    let inputEmail = "";
    let inputPassword = "";
    const inputs = this.page.locator("input");
    for (let index = 0; index < (await inputs.count()); index++) {
      const input = inputs.nth(index);
      const value = await input.inputValue().catch(() => "");
      if (!value) continue;
      const label = [
        await input.getAttribute("aria-label"),
        await input.getAttribute("placeholder"),
        await input.getAttribute("name"),
        await input.getAttribute("id"),
      ]
        .filter(Boolean)
        .join(" ");
      if (!inputEmail && (value.includes("@") || /email/i.test(label))) inputEmail = value;
      if (!inputPassword && /temp|password/i.test(label) && !value.includes("@")) inputPassword = value;
    }

    let href = "";
    const workspaceLink = this.page
      .getByRole("link", { name: /open university workspace|open workspace/i })
      .first();
    href = (await workspaceLink.getAttribute("href").catch(() => null)) ?? "";
    if (!href) {
      const link = this.page.locator('a[href^="http"]').last();
      href = (await link.getAttribute("href").catch(() => null)) ?? "";
    }

    const parsed = parseHandoverText(body);
    return {
      administratorEmail: inputEmail || parsed.administratorEmail || "",
      temporaryPassword: inputPassword || parsed.temporaryPassword || "",
      tenantUrl: href.startsWith("http") ? href : parsed.tenantUrl || "",
    };
  }

  /** Opens the newly provisioned university workspace from the handover. */
  async openUniversityWorkspace(): Promise<void> {
    await this.openUniversityWorkspaceButton.click();
  }
}

/**
 * Best-effort text parse for the handover fallback. The network response is the
 * primary source; this only fills gaps when the response is redacted.
 */
function parseHandoverText(body: string): Partial<PlatformHandover> {
  const emailMatch = body.match(/Administrator email[\s\S]{0,120}?([\w.+-]+@[\w.-]+\.\w+)/i);
  const passwordMatch = body.match(
    /(?:Temporary password|temporary_password)[\s\S]{0,120}?[:：]?\s*([A-Za-z0-9!@#$%^&*._-]{8,})/i,
  );
  const urlMatch = body.match(/https:\/\/[^\s"'<>]+/i);

  return {
    ...(emailMatch ? { administratorEmail: emailMatch[1] } : {}),
    ...(passwordMatch ? { temporaryPassword: passwordMatch[1] } : {}),
    ...(urlMatch ? { tenantUrl: urlMatch[0] } : {}),
  };
}
