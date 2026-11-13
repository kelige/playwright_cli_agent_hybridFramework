import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
import * as fs from "fs";

// The Admin session is captured once by the `setup` project and reused by the
// chromium project. If the file is absent (first run, or no Admin credentials)
// the specs fall back to an in-test UI login.
const adminAuthFile = "playwright/.auth/admin.json";
const storageState = fs.existsSync(adminAuthFile) ? adminAuthFile : undefined;

export default defineConfig({
  testDir: "./tests",
  timeout: Number(process.env.PLAYWRIGHT_TIMEOUT ?? 30_000),
  expect: { timeout: Number(process.env.PLAYWRIGHT_EXPECT_TIMEOUT ?? 10_000) },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["list"], // Detailed console output
    ["html", { open: "never", outputFolder: "reports" }], // HTML Report
    ["junit", { outputFile: "reports/results.xml" }], // JUnit XML Report
    ["./utils/CustomReporter.ts"], // Custom reporter
    ["allure-playwright", { outputFolder: "allure-results" }], // Allure Report
  ],
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    headless: (process.env.PLAYWRIGHT_HEADLESS ?? "true") !== "false",
    viewport: { width: 1280, height: 720 }, // Set default viewport size for consistency
    ignoreHTTPSErrors: true, // Ignore SSL errors if necessary
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      // First-login spec consumes the one-time credential, so it runs without the
      // stored Admin session and must execute once per provisioned account.
      name: "first-login",
      testMatch: /tests[\\/]web[\\/]authentication[\\/]first-login.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Pure HTTP tests: no browser session, so no dependency on the UI `setup` login.
      name: "api",
      // Logout ends every session of the shared Admin account, so API specs run in order.
      fullyParallel: false,
      testMatch: /tests[\\/]api[\\/].*\.spec\.ts/,
    },
    {
      name: "chromium",
      testIgnore: [
        /tests[\\/]web[\\/]authentication[\\/]first-login.*\.spec\.ts/,
        /tests[\\/]api[\\/]/,
      ],
      use: { ...devices["Desktop Chrome"], storageState },
      dependencies: ["setup"],
    },
  ],
});
