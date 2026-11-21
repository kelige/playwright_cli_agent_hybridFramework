import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
import * as fs from "fs";

// The Admin session is captured once by the `setup` project and reused by the
// chromium project. If the file is absent (first run, or no Admin credentials)
// the specs fall back to an in-test UI login.
const adminAuthFile = "playwright/.auth/admin.json";
const storageState = fs.existsSync(adminAuthFile) ? adminAuthFile : undefined;

// The parallel test-case runner gives each role its own report folders so one
// role's report cannot overwrite another's.
const reportDir = process.env.PW_REPORT_DIR ?? "reports";
const junitFile = process.env.PW_JUNIT_FILE ?? "reports/results.xml";
// The university-matrix run gives every tenant its own Allure folder so
// concurrent children never write the same files.
const allureDir = process.env.ALLURE_RESULTS_DIR ?? "allure-results";

// The live workflow project starts a headed browser and waits for a human at the
// camera, so it only joins the run when the workflow command asks for it.
const liveWorkflowRequested =
  ["workflow", "test:workflow", "workflow:all", "test:platform", "test:testcases"].includes(
    process.env.npm_lifecycle_event ?? "",
  ) || process.env.DVS_LIVE_WORKFLOW === "true";

export default defineConfig({
  testDir: "./tests",
  timeout: Number(process.env.PLAYWRIGHT_TIMEOUT ?? 30_000),
  expect: { timeout: Number(process.env.PLAYWRIGHT_EXPECT_TIMEOUT ?? 10_000) },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["list"], // Detailed console output
    ["html", { open: "never", outputFolder: reportDir }], // HTML Report
    ["junit", { outputFile: junitFile }], // JUnit XML Report
    ["./utils/CustomReporter.ts"], // Custom reporter
    ["./utils/CaseResultReporter.ts"], // Green tick / red reason summary
    ["allure-playwright", { outputFolder: allureDir }], // Allure Report
  ],
  use: {
    // A zero test timeout (used for the human-in-the-loop face waits) would
    // otherwise let a single blocked click wait forever. Actions stay bounded;
    // only the explicit face polling loops are unbounded.
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
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
      // Per-case API suites and the full role workflow run as their own projects.
      testIgnore: [/tests[\\/]api[\\/]workflow[\\/]/, /tests[\\/]api[\\/]testcases[\\/]/],
    },
    {
      // Full API role workflow: Admin -> User Manager -> Chairman -> Chief -> Evaluator -> Scanner.
      name: "workflow-api",
      fullyParallel: false,
      testMatch: /tests[\\/]api[\\/]workflow[\\/]dvs-role-workflow\.spec\.ts/,
    },
    {
      // Read-only database workflow tests: no browser session and no setup dependency.
      name: "db",
      fullyParallel: false,
      testMatch: /tests[\\/]db[\\/].*\.spec\.ts/,
      testIgnore: [/tests[\\/]db[\\/]testcases[\\/]/],
    },
    {
      // Per-case API suites: one case ID per check, defect-aware.
      name: "testcases-api",
      fullyParallel: false,
      testMatch: /tests[\\/]api[\\/]testcases[\\/].*\.spec\.ts/,
    },
    {
      // Per-case database suites: read-only checks only.
      name: "testcases-db",
      fullyParallel: false,
      testMatch: /tests[\\/]db[\\/]testcases[\\/].*\.spec\.ts/,
    },
    {
      // Platform console bootstrap: provisions a new university and completes
      // the administrator handover. Headed so the run is watchable.
      name: "platform",
      fullyParallel: false,
      testMatch: /tests[\\/]web[\\/]platform[\\/].*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], headless: false },
    },
    {
      // Per-role test-case suites: each spec signs in as its own role, records
      // any defect in docs/BUG_DVS.md and keeps running.
      name: "testcases",
      fullyParallel: false,
      testMatch: /tests[\\/]web[\\/]testcases[\\/].*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], headless: false },
    },
    {
      // Parallel multi-university runner: provisions N tenants and drives each
      // one in its own child process. Run it on its own, not with the other projects.
      name: "matrix",
      fullyParallel: false,
      testMatch: /tests[\\/]matrix[\\/].*\.spec\.ts/,
    },
    {
      // Headed continuation for one matrix university: the Evaluator completes
      // the face check, then evaluation, moderation and the Admin report run.
      // The matrix starts this one university at a time.
      name: "matrix-evaluate",
      fullyParallel: false,
      testMatch: /tests[\\/]web[\\/]workflow[\\/]evaluate-tenant\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        headless: false,
        permissions: ["camera", "microphone", "geolocation"],
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--disable-background-timer-throttling",
          ],
        },
      },
    },
    {
      name: "chromium",
      testIgnore: [
        /tests[\\/]matrix[\\/]/,
        /tests[\\/]web[\\/]authentication[\\/]first-login.*\.spec\.ts/,
        /tests[\\/]web[\\/]workflow[\\/]/,
        /tests[\\/]web[\\/]platform[\\/]/,
        /tests[\\/]web[\\/]testcases[\\/]/,
        /tests[\\/]api[\\/]/,
        /tests[\\/]db[\\/]/,
      ],
      use: { ...devices["Desktop Chrome"], storageState },
      dependencies: ["setup"],
    },
    ...(liveWorkflowRequested
      ? [
          {
            // Live human-in-the-loop continuation: headed browser, real camera,
            // waits for face enrollment and then completes evaluation and reporting.
            // It provisions its own records, so it must not depend on `workflow-api`.
            name: "workflow",
            fullyParallel: false,
            testMatch: /tests[\\/]web[\\/]workflow[\\/](?!evaluate-tenant\.spec\.ts).*\.spec\.ts/,
            use: {
              ...devices["Desktop Chrome"],
              headless: false,
              permissions: ["camera", "microphone", "geolocation"],
              launchOptions: {
                args: [
                  "--use-fake-ui-for-media-stream",
                  // Face/liveness checks run on video frames; Chromium throttles
                  // occluded windows, which pauses those checks indefinitely.
                  "--disable-backgrounding-occluded-windows",
                  "--disable-renderer-backgrounding",
                  "--disable-background-timer-throttling",
                ],
              },
            },
          },
        ]
      : []),
  ],
});
