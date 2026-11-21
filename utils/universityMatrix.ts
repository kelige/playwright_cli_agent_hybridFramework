import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import * as XLSX from "xlsx";
import {
  PlatformSession,
  nextUniversityNumber,
  platformBaseUrl,
  provisionUniversity,
} from "./platformClient";
import {
  applyEvaluationTimingPolicy,
  completeUniversityAdminFirstLogin,
  type ProvisionedUniversity,
} from "./tenantBootstrap";

/** One university in the matrix run. */
export type MatrixJob = {
  index: number;
  number: number;
  name: string;
  code: string;
  adminEmail: string;
  tenantId: string;
  tenantUrl: string;
  dir: string;
  /** Applied evaluation timing policy, or why it could not be applied. */
  policyNote?: string;
  error?: string;
};

/** One executed case, read back from the child's JUnit XML. */
export type MatrixCase = {
  name: string;
  className: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  reason: string;
};

/** Outcome of one phase (API setup or headed evaluation) for one university. */
export type MatrixPhase = {
  status: "passed" | "failed" | "skipped";
  exitCode: number;
  durationMs: number;
  totals: { total: number; passed: number; failed: number; skipped: number };
  cases: MatrixCase[];
  error: string;
  paths: {
    report: string;
    playwrightHtml: string;
    junit: string;
    log: string;
    /** Admin evaluation report HTML, when the evaluation produced one. */
    adminReport?: string;
  };
};

/** Outcome of one university's workflow child process. */
export type MatrixResult = {
  job: MatrixJob;
  /** Combined status: passes only when the API phase and evaluation both pass. */
  status: "passed" | "failed" | "skipped";
  apiStatus: "passed" | "failed" | "skipped";
  evaluation?: MatrixPhase;
  exitCode: number;
  startedAt: string;
  durationMs: number;
  totals: { total: number; passed: number; failed: number; skipped: number };
  cases: MatrixCase[];
  error: string;
  paths: {
    report: string;
    playwrightHtml: string;
    junit: string;
    log: string;
  };
};

export type MatrixSummary = {
  startedAt: string;
  durationMs: number;
  count: number;
  concurrency: number;
  passed: number;
  failed: number;
  skipped: number;
  evaluate: boolean;
  evaluated: number;
  evaluationPassed: number;
  totals: { total: number; passed: number; failed: number; skipped: number };
  results: MatrixResult[];
  paths: {
    index: string;
    xlsx: string;
    csv: string;
    credentials: string;
    json: string;
    markdown: string;
  };
};

const MATRIX_DIR = path.resolve(process.cwd(), "docs", "reports", "university-matrix");

/** Absolute folder that holds every matrix artifact. */
export function matrixDirectory(): string {
  return MATRIX_DIR;
}

/** Escapes text for the generated HTML pages. */
function escape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Decodes the XML entities JUnit writers emit in attribute values. */
function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Parses `key="value"` pairs from an XML attribute string. */
function xmlAttributes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of text.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    out[match[1]] = decodeXml(match[2]);
  }
  return out;
}

/** Reads one JUnit file into cases. A missing file means no results. */
function parseJunit(file: string): MatrixCase[] {
  if (!fs.existsSync(file)) return [];
  const xml = fs.readFileSync(file, "utf-8");
  const cases: MatrixCase[] = [];
  const pattern = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;

  for (const match of xml.matchAll(pattern)) {
    const attributes = xmlAttributes(match[1] ?? "");
    const body = match[2] ?? "";
    const failure =
      /<failure\b([^>]*)(?:\/>|>([\s\S]*?)<\/failure>)/.exec(body) ??
      /<error\b([^>]*)(?:\/>|>([\s\S]*?)<\/error>)/.exec(body);
    const skipped = /<skipped\b/.test(body);
    const reason = failure
      ? (xmlAttributes(failure[1] ?? "").message || (failure[2] ?? "").trim()).slice(0, 4000)
      : skipped
        ? "Skipped"
        : "";

    cases.push({
      name: attributes.name || "(unnamed test)",
      className: attributes.classname || "",
      status: failure ? "failed" : skipped ? "skipped" : "passed",
      durationMs: Math.round(Number(attributes.time ?? 0) * 1000),
      reason,
    });
  }
  return cases;
}

/**
 * Resolves when `file` appears. The face step has no deadline, so this polls
 * until the evaluator finishes it.
 * @param file - Marker written by the evaluation child
 */
function waitForFile(file: string): Promise<void> {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!fs.existsSync(file)) return;
      clearInterval(timer);
      resolve();
    }, 1_000);
  });
}

/** Runs `worker` over `items` with a bounded pool, preserving input order. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Throws when a required matrix setting is missing. */
function requireEnvironment(): string {
  const platform = platformBaseUrl();
  const email = process.env.PLATFORM_ADMIN_EMAIL ?? "";
  const password = process.env.PLATFORM_ADMIN_PASSWORD ?? "";
  const domain = (process.env.PLATFORM_BASE_DOMAIN ?? "").trim();
  const tenantPassword =
    process.env.DVS_ROLE_NEW_PASSWORD || process.env.DVS_UNIVERSITY_ADMIN_PASSWORD || "";

  const missing = [
    !platform && "PLATFORM_URL",
    !email && "PLATFORM_ADMIN_EMAIL",
    !password && "PLATFORM_ADMIN_PASSWORD",
    !domain && "PLATFORM_BASE_DOMAIN",
    !tenantPassword && "DVS_ROLE_NEW_PASSWORD",
    process.env.DVS_ALLOW_WRITES !== "true" && "DVS_ALLOW_WRITES=true",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`The university matrix is not configured: missing ${missing.join(", ")}.`);
  }
  return tenantPassword;
}

/**
 * Creates `count` universities on the platform control plane and completes each
 * administrator's first login. A failure is captured on its job and never stops
 * the other universities.
 * @param count - How many universities to create
 * @param concurrency - Parallel provisioning limit
 * @param tenantPassword - Permanent administrator password
 * @returns Jobs in creation order
 */
export async function provisionUniversities(
  count: number,
  concurrency: number,
  tenantPassword: string,
): Promise<MatrixJob[]> {
  fs.mkdirSync(MATRIX_DIR, { recursive: true });

  const session = await PlatformSession.login(
    process.env.PLATFORM_ADMIN_EMAIL ?? "",
    process.env.PLATFORM_ADMIN_PASSWORD ?? "",
  );
  if (session.loginResponse.status() !== 200) {
    await session.dispose();
    throw new Error(`Platform login failed (${session.loginResponse.status()}).`);
  }

  let start = 1;
  try {
    start = await nextUniversityNumber(session);
  } catch (error) {
    await session.dispose();
    throw error;
  }

  const jobs: MatrixJob[] = Array.from({ length: count }, (_, index) => {
    const number = start + index;
    const code = `automation-testing-${number}`;
    return {
      index,
      number,
      name: `Automation testing -${number}`,
      code,
      adminEmail: `automation.testing.${number}@example.com`,
      tenantId: "",
      tenantUrl: "",
      dir: path.join(MATRIX_DIR, code),
    };
  });

  try {
    await mapPool(jobs, concurrency, async (job) => {
      fs.mkdirSync(job.dir, { recursive: true });
      try {
        const handover = await provisionUniversity(session, {
          name: job.name,
          code: job.code,
          adminEmail: job.adminEmail,
          adminFirstName: "Automation",
          adminLastName: "University Admin",
          plan: process.env.DVS_UNIVERSITY_PLAN || "enterprise",
        });
        const university: ProvisionedUniversity = await completeUniversityAdminFirstLogin(
          handover,
          tenantPassword,
        );
        job.tenantId = university.tenantId;
        job.tenantUrl = university.tenantUrl;

        // Access governance > Evaluation security > Time and inactivity:
        // minimum submission time is 0, so the evaluator never waits before
        // submitting once every page is marked.
        try {
          const policy = await applyEvaluationTimingPolicy(
            university.tenantUrl,
            university.adminEmail,
            tenantPassword,
          );
          job.policyNote =
            policy.minimumSubmissionMinutes === 0
              ? `minimum submission time 0, ${policy.disabledFlags} evaluation flag(s) off`
              : `minimum submission time key not found; ${policy.disabledFlags} evaluation flag(s) off`;
          console.log(`POLICY ${job.name}: ${job.policyNote}`);
        } catch (error) {
          job.policyNote = `policy not applied: ${
            error instanceof Error ? error.message : String(error)
          }`;
          console.log(`POLICY WARNING ${job.name}: ${job.policyNote}`);
        }

        // Durable record without the one-time handover password.
        fs.writeFileSync(
          path.join(job.dir, "tenant.json"),
          JSON.stringify(
            {
              name: university.name,
              code: university.code,
              tenantId: university.tenantId,
              tenantUrl: university.tenantUrl,
              adminEmail: university.adminEmail,
              policy: job.policyNote,
            },
            null,
            2,
          ),
        );
        // Seed the tenant's run state so the later headed evaluation phase can
        // resolve this university's name and URL. The API workflow merges its
        // ids and role emails into this same file.
        fs.writeFileSync(
          path.join(job.dir, "run-state.json"),
          JSON.stringify(
            {
              university: {
                tenantId: university.tenantId,
                name: university.name,
                code: university.code,
                tenantUrl: university.tenantUrl,
                adminEmail: university.adminEmail,
              },
            },
            null,
            2,
          ),
        );
        console.log(`PROVISIONED ${job.name} -> ${job.tenantUrl}`);
      } catch (error) {
        job.error = error instanceof Error ? error.message : String(error);
        console.log(`PROVISION FAILED ${job.name}: ${job.error}`);
      }
    });
  } finally {
    await session.dispose();
  }

  return jobs;
}

/** Builds the isolated environment a tenant's workflow child runs with. */
function childEnvironment(job: MatrixJob, tenantPassword: string): NodeJS.ProcessEnv {
  const reportsDir = path.join(job.dir, "reports");
  return {
    ...process.env,
    WEB_APP_URL: job.tenantUrl,
    DVS_WEB_BASE_URL: job.tenantUrl,
    DVS_BASE_URL: job.tenantUrl,
    DVS_API_BASE_URL: job.tenantUrl,
    DVS_TENANT_ID: job.tenantId,
    DVS_TENANT_NAME: job.name,
    DVS_ADMIN_EMAIL: job.adminEmail,
    DVS_ADMIN_PASSWORD: tenantPassword,
    DVS_UNIVERSITY_NAME: job.name,
    DVS_UNIVERSITY_CODE: job.code,
    DVS_UNIVERSITY_ADMIN_EMAIL: job.adminEmail,
    DVS_UNIVERSITY_ADMIN_PASSWORD: tenantPassword,
    // User emails are globally unique; a per-university suffix prevents two
    // concurrent children from provisioning the same mailbox.
    DVS_RUN_ID: `m${job.number}`,
    // Different marks for every university, never the same full-mark script.
    DVS_MARKS_SEED: process.env.DVS_MARKS_SEED?.trim() || `university-${job.number}`,
    // Fast mode skips the four deliberately-failing checks.
    DVS_MATRIX_FAST: process.env.DVS_MATRIX_FAST ?? "false",
    DVS_ALLOW_WRITES: "true",
    DVS_FACE_READY_FILE: path.join(job.dir, "face-ready.flag"),
    // A full role chain creates accounts and uploads documents; the 30s default
    // is too small for a slow tenant, so give the whole chain room.
    PLAYWRIGHT_TIMEOUT: process.env.DVS_MATRIX_TEST_TIMEOUT || "180000",
    PLAYWRIGHT_EXPECT_TIMEOUT: process.env.DVS_MATRIX_EXPECT_TIMEOUT || "20000",
    // Every run-scoped file is local to this university.
    DVS_ENV_FILE: path.join(job.dir, ".env"),
    DVS_STATE_FILE: path.join(job.dir, "run-state.json"),
    DVS_DEFECT_FILE: path.join(job.dir, "defects.md"),
    DVS_REPORT_ROOT: reportsDir,
    PW_REPORT_DIR: path.join(job.dir, "html"),
    PW_JUNIT_FILE: path.join(job.dir, "results.xml"),
    CUSTOM_REPORT_DIR: path.join(job.dir, "dashboard"),
    CASE_RESULTS_FILE: path.join(job.dir, "cases.html"),
    CASE_RESULTS_JSONL: path.join(job.dir, "cases.jsonl"),
    CASE_RESULTS_OPEN: "false",
    ALLURE_RESULTS_DIR: path.join(job.dir, "allure-results"),
    DVS_OPEN_SUMMARY: "false",
  };
}

/** One role's login for a provisioned university. */
export type CredentialRow = { role: string; email: string; password: string };

/** Reads `KEY=value` pairs from a per-university `.env`. */
function readEnvFile(file: string): Map<string, string> {
  const values = new Map<string, string>();
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, "utf-8").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    values.set(line.slice(0, index).trim(), line.slice(index + 1).trim());
  }
  return values;
}

/**
 * Collects every role login for one university. The API workflow writes the
 * role emails to the university's `.env` and run state carries them too.
 * @param job - Provisioned university
 * @param tenantPassword - Standard permanent password assigned to every role
 */
export function credentialRows(job: MatrixJob, tenantPassword: string): CredentialRow[] {
  const env = readEnvFile(path.join(job.dir, ".env"));
  let emails: Record<string, string> = {};
  try {
    const state = JSON.parse(
      fs.readFileSync(path.join(job.dir, "run-state.json"), "utf-8"),
    ) as { emails?: Record<string, string> };
    emails = state.emails ?? {};
  } catch {
    emails = {};
  }
  const pick = (envKey: string, stateKey: string): string =>
    env.get(envKey)?.trim() || emails[stateKey] || "";

  return [
    { role: "University Admin", email: job.adminEmail, password: tenantPassword },
    { role: "User Manager", email: pick("DVS_USER_MANAGER_EMAIL", "userManager"), password: tenantPassword },
    { role: "Chairman", email: pick("DVS_CHAIRMAN_EMAIL", "chairman"), password: tenantPassword },
    { role: "Chief Examiner", email: pick("DVS_CHIEF_EMAIL", "chief"), password: tenantPassword },
    { role: "Evaluator", email: pick("DVS_EVALUATOR_EMAIL", "evaluator"), password: tenantPassword },
    { role: "Scanner Operator", email: pick("DVS_SCANNER_EMAIL", "scanner"), password: tenantPassword },
  ];
}

/** Writes the university's role logins to `credentials.csv`. */
function writeCredentialFile(job: MatrixJob, tenantPassword: string): string {
  const file = path.join(job.dir, "credentials.csv");
  const rows = credentialRows(job, tenantPassword).map((row) =>
    [row.role, row.email, row.password].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","),
  );
  fs.writeFileSync(file, `\uFEFF${['"Role","Email","Password"', ...rows].join("\r\n")}`);
  return file;
}

/**
 * Runs one university's API role workflow in its own Playwright process.
 * @param job - Provisioned university
 * @param tenantPassword - Permanent administrator password
 * @returns Result with parsed cases and artifact paths
 */
export function runMatrixJob(job: MatrixJob, tenantPassword: string): Promise<MatrixResult> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const logPath = path.join(job.dir, "run.log");
  const junit = path.join(job.dir, "results.xml");
  const html = path.join(job.dir, "html", "index.html");

  if (job.error || !job.tenantUrl) {
    return Promise.resolve({
      job,
      status: "failed",
      apiStatus: "failed",
      exitCode: 1,
      startedAt,
      durationMs: 0,
      totals: { total: 0, passed: 0, failed: 0, skipped: 0 },
      cases: [],
      error: job.error || "The university was not provisioned.",
      paths: { report: path.join(job.dir, "report.html"), playwrightHtml: html, junit, log: logPath },
    });
  }

  fs.mkdirSync(job.dir, { recursive: true });
  const log = fs.createWriteStream(logPath);
  log.write(`# University: ${job.name} (${job.code})\n# Tenant: ${job.tenantUrl}\n# Started: ${startedAt}\n\n`);

  console.log(`START  ${job.code}`);

  return new Promise((resolve) => {
    const cli = path.join(process.cwd(), "node_modules", "playwright", "cli.js");
    const child = spawn(
      process.execPath,
      [
        cli,
        "test",
        "--project=workflow-api",
        "--workers=1",
        `--output=${path.join("test-results", "university-matrix", job.code)}`,
      ],
      { cwd: process.cwd(), env: childEnvironment(job, tenantPassword) },
    );

    child.stdout.on("data", (chunk) => log.write(chunk));
    child.stderr.on("data", (chunk) => log.write(chunk));
    child.on("error", (error) => log.write(`\nSpawn error: ${error.message}\n`));

    child.on("close", (code) => {
      const durationMs = Date.now() - started;
      const cases = parseJunit(junit);
      const totals = {
        total: cases.length,
        passed: cases.filter((row) => row.status === "passed").length,
        failed: cases.filter((row) => row.status === "failed").length,
        skipped: cases.filter((row) => row.status === "skipped").length,
      };
      const exitCode = code ?? 1;
      const failedCase = cases.find((row) => row.status === "failed");
      const error = failedCase?.reason || (exitCode !== 0 ? `Playwright exited with ${exitCode}.` : "");
      const apiStatus: "passed" | "failed" =
        exitCode === 0 && totals.failed === 0 ? "passed" : "failed";
      const result: MatrixResult = {
        job,
        status: apiStatus,
        apiStatus,
        exitCode,
        startedAt,
        durationMs,
        totals,
        cases,
        error,
        paths: { report: path.join(job.dir, "report.html"), playwrightHtml: html, junit, log: logPath },
      };

      log.write(`\n# Finished: ${new Date().toISOString()}\n# Exit: ${exitCode}\n# Cases: ${totals.passed}/${totals.total} passed\n`);
      log.end();

      writeCredentialFile(job, tenantPassword);
      fs.writeFileSync(result.paths.report, renderUniversityReport(result, tenantPassword));
      console.log(
        `${result.status === "passed" ? "PASS" : "FAIL"}   ${job.code} (${Math.round(
          durationMs / 1000,
        )}s, ${totals.passed}/${totals.total} cases)`,
      );
      resolve(result);
    });
  });
}

/** Environment for the headed one-university evaluation child. */
function evaluationEnvironment(job: MatrixJob, tenantPassword: string): NodeJS.ProcessEnv {
  return {
    ...childEnvironment(job, tenantPassword),
    PW_REPORT_DIR: path.join(job.dir, "evaluate-html"),
    PW_JUNIT_FILE: path.join(job.dir, "evaluate-results.xml"),
    CUSTOM_REPORT_DIR: path.join(job.dir, "evaluate-dashboard"),
    CASE_RESULTS_FILE: path.join(job.dir, "evaluate-cases.html"),
    CASE_RESULTS_JSONL: path.join(job.dir, "evaluate-cases.jsonl"),
    ALLURE_RESULTS_DIR: path.join(job.dir, "evaluate-allure-results"),
    DVS_REPORT_ROOT: path.join(job.dir, "reports"),
    // 0 waits until the application confirms the face step, so the operator has
    // no deadline in the open window.
    FACE_ENROLLMENT_TIMEOUT_MS: process.env.FACE_ENROLLMENT_TIMEOUT_MS ?? "0",
    DVS_OPEN_SUMMARY: "false",
  };
}

/** Newest file matching a folder pattern, or an empty string. */
function newestFile(dir: string, predicate: (file: string) => boolean): string {
  if (!fs.existsSync(dir)) return "";
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (predicate(entry.name)) files.push(full);
    }
  };
  walk(dir);
  if (files.length === 0) return "";
  return files.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0];
}

/**
 * Runs the headed evaluation continuation for one university: face check,
 * marking, moderation, Chairman forwarding and the Admin report (HTML + CSV).
 * Evaluation runs one university at a time because it needs the camera and a
 * human at the face step.
 * @param job - University whose packet is ready
 * @param tenantPassword - Permanent administrator password
 * @returns Phase result with the Admin report paths
 */
export function runEvaluationJob(job: MatrixJob, tenantPassword: string): Promise<MatrixPhase> {
  const started = Date.now();
  const logPath = path.join(job.dir, "evaluate.log");
  const junit = path.join(job.dir, "evaluate-results.xml");
  const html = path.join(job.dir, "evaluate-html", "index.html");

  if (job.error || !job.tenantUrl) {
    return Promise.resolve({
      status: "skipped",
      exitCode: 1,
      durationMs: 0,
      totals: { total: 0, passed: 0, failed: 0, skipped: 0 },
      cases: [],
      error: "The university was not provisioned.",
      paths: { report: path.join(job.dir, "report.html"), playwrightHtml: html, junit, log: logPath },
    });
  }

  console.log(`\nEVALUATE  ${job.code} — complete the face check in the open window`);
  const log = fs.createWriteStream(logPath);
  log.write(`# Headed evaluation: ${job.name} (${job.tenantUrl})\n# Started: ${new Date().toISOString()}\n\n`);

  return new Promise((resolve) => {
    const cli = path.join(process.cwd(), "node_modules", "playwright", "cli.js");
    const child = spawn(
      process.execPath,
      [
        cli,
        "test",
        "--project=matrix-evaluate",
        "--workers=1",
        `--output=${path.join("test-results", "university-matrix-eval", job.code)}`,
      ],
      { cwd: process.cwd(), env: evaluationEnvironment(job, tenantPassword) },
    );

    child.stdout.on("data", (chunk) => log.write(chunk));
    child.stderr.on("data", (chunk) => log.write(chunk));
    child.on("error", (error) => log.write(`\nSpawn error: ${error.message}\n`));

    child.on("close", (code) => {
      const durationMs = Date.now() - started;
      const cases = parseJunit(junit);
      const totals = {
        total: cases.length,
        passed: cases.filter((row) => row.status === "passed").length,
        failed: cases.filter((row) => row.status === "failed").length,
        skipped: cases.filter((row) => row.status === "skipped").length,
      };
      const exitCode = code ?? 1;
      const failedCase = cases.find((row) => row.status === "failed");
      const error = failedCase?.reason || (exitCode !== 0 ? `Playwright exited with ${exitCode}.` : "");
      const adminReport =
        newestFile(path.join(job.dir, "reports", "artifacts"), (name) => name === "report.html") || undefined;

      log.write(`\n# Finished: ${new Date().toISOString()}\n# Exit: ${exitCode}\n`);
      log.end();

      const phase: MatrixPhase = {
        status: exitCode === 0 && totals.failed === 0 ? "passed" : "failed",
        exitCode,
        durationMs,
        totals,
        cases,
        error,
        paths: { report: path.join(job.dir, "report.html"), playwrightHtml: html, junit, log: logPath, adminReport },
      };
      console.log(
        `${phase.status === "passed" ? "EVAL PASS" : "EVAL FAIL"} ${job.code} (${Math.round(
          durationMs / 1000,
        )}s)${adminReport ? ` report: ${adminReport}` : ""}`,
      );
      resolve(phase);
    });
  });
}

/** True when the path exists, so links never point at missing files. */
function link(from: string, target: string, label: string): string {
  if (!fs.existsSync(target)) return `<span class="muted">${escape(label)}: —</span>`;
  const relative = path.relative(from, target).replace(/\\/g, "/");
  return `<a href="${escape(relative)}">${escape(label)}</a>`;
}

/**
 * Keeps only the results page, the credentials and the Admin report. Logs,
 * Playwright HTML/JUnit output, run state, `.env` and dashboards are removed.
 * Set `DVS_MATRIX_KEEP_FILES=true` (or `--keep-files`) to retain them for debugging.
 * @param job - University whose run has finished
 */
export function cleanupJobArtifacts(job: MatrixJob): void {
  if (process.env.DVS_MATRIX_KEEP_FILES === "true") return;

  for (const name of [
    ".env",
    "run-state.json",
    "tenant.json",
    "run.log",
    "evaluate.log",
    "defects.md",
    "face-ready.flag",
    "cases.html",
    "cases.json",
    "cases.jsonl",
    "results.xml",
    "evaluate-results.xml",
    "evaluate-cases.html",
    "evaluate-cases.jsonl",
    "evaluate-cases.json",
  ]) {
    fs.rmSync(path.join(job.dir, name), { recursive: true, force: true });
  }
  for (const name of [
    "dashboard",
    "html",
    "evaluate-dashboard",
    "evaluate-html",
    "allure-results",
    "evaluate-allure-results",
  ]) {
    fs.rmSync(path.join(job.dir, name), { recursive: true, force: true });
  }
  for (const root of ["university-matrix", "university-matrix-eval"]) {
    fs.rmSync(path.join(process.cwd(), "test-results", root, job.code), {
      recursive: true,
      force: true,
    });
  }

  // Keep the Admin report (CSV/Excel/HTML) but drop its JSON and duplicate
  // summary pages, plus the workflow checklist copy.
  fs.rmSync(path.join(job.dir, "reports", "workflow-summary.html"), { force: true });
  const artifacts = path.join(job.dir, "reports", "artifacts");
  if (fs.existsSync(artifacts)) {
    for (const entry of fs.readdirSync(artifacts, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const name of ["report.json", "summary.html"]) {
        fs.rmSync(path.join(artifacts, entry.name, name), { force: true });
      }
    }
  }
}

/** Renders one university's result page: ticks, credentials and Admin report. */
function renderUniversityReport(result: MatrixResult, tenantPassword: string): string {
  const evaluation = result.evaluation;
  const hasCase = (prefix: string): boolean =>
    result.cases.some((row) => row.status === "passed" && row.name.includes(prefix));
  const adminCsv =
    newestFile(path.join(result.job.dir, "reports"), (name) => name.toLowerCase().endsWith(".csv")) ||
    "";
  const adminXlsx =
    newestFile(path.join(result.job.dir, "reports"), (name) => name.toLowerCase().endsWith(".xlsx")) ||
    "";
  const checklist: { label: string; ok: boolean }[] = [
    { label: "University provisioned", ok: Boolean(result.job.tenantUrl) && !result.job.error },
    {
      label: "Academic chain, paper, marking scheme and centre ready",
      ok: hasCase("1)") && hasCase("2)") && hasCase("3)"),
    },
    { label: "Security policy saved", ok: hasCase("4)") },
    { label: "User Manager and Chairman created", ok: hasCase("5)") },
    { label: "Chief Examiner registered and nominated", ok: hasCase("6)") },
    { label: "Evaluator registered and nominated", ok: hasCase("7)") },
    { label: "Scanner Operator created", ok: hasCase("8)") },
    { label: "Script digitized and packet submitted", ok: hasCase("9)") },
    {
      label: "Evaluator face verified, marks entered and submitted",
      ok: evaluation?.status === "passed",
    },
    {
      label: "Moderation, Chairman forwarding and Admin report",
      ok: Boolean(adminCsv || evaluation?.paths.adminReport),
    },
  ];
  const failures = [...result.cases, ...(evaluation?.cases ?? [])].filter(
    (row) => row.status === "failed",
  );

  const credentialCsv = path.join(result.job.dir, "credentials.csv");
  const credentialTable = credentialRows(result.job, tenantPassword)
    .map(
      (row) => `<tr>
        <td>${escape(row.role)}</td>
        <td><code>${escape(row.email || "—")}</code></td>
        <td><code>${escape(row.password)}</code></td>
      </tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(result.job.name)} · ${escape(result.status)}</title>
<style>
  body { margin:0; font-family:"Segoe UI",system-ui,sans-serif; background:#f4f6f8; color:#1c2430; }
  main { max-width:1100px; margin:0 auto; padding:32px 24px 48px; }
  h1 { margin:0 0 4px; font-size:24px; }
  .muted { color:#5d6b7a; font-size:13px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin:22px 0; }
  .card { background:#fff; border:1px solid #dde3ea; border-radius:10px; padding:14px 16px; }
  .card span { display:block; font-size:12px; text-transform:uppercase; color:#6b7a89; }
  .card strong { display:block; margin-top:6px; font-size:22px; }
  .pass { color:#16a34a; } .fail { color:#dc2626; }
  table { width:100%; border-collapse:collapse; background:#fff; border:1px solid #dde3ea; border-radius:10px; overflow:hidden; }
  th,td { text-align:left; padding:10px 14px; border-bottom:1px solid #eef1f5; font-size:13px; vertical-align:top; }
  th { background:#f8fafc; font-size:12px; text-transform:uppercase; color:#6b7a89; }
  tr.passed td:first-child { color:#16a34a; font-weight:800; }
  tr.failed td:first-child { color:#dc2626; font-weight:800; }
  pre { margin:0; white-space:pre-wrap; color:#991b1b; background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:8px; font-size:12px; }
  .links { margin-top:18px; display:flex; gap:16px; flex-wrap:wrap; font-size:13px; }
  a { color:#1d4ed8; }
  h3 { margin:24px 0 8px; font-size:16px; }
  ul.checklist { list-style:none; margin:10px 0; padding:0; background:#fff; border:1px solid #dde3ea; border-radius:10px; overflow:hidden; }
  ul.checklist li { display:flex; gap:10px; align-items:center; padding:10px 14px; border-bottom:1px solid #eef1f5; font-size:13px; }
  ul.checklist li:last-child { border-bottom:none; }
  ul.checklist .tick { flex:0 0 auto; width:22px; height:22px; line-height:22px; border-radius:6px; text-align:center; color:#fff; font-weight:800; background:#16a34a; }
  ul.checklist li.todo { color:#991b1b; }
  ul.checklist li.todo .tick { background:#dc2626; }
</style></head><body><main>
<h1>${escape(result.job.name)}</h1>
<div class="muted">${escape(result.job.tenantUrl || "not provisioned")} · ${escape(result.job.code)} · Admin ${escape(result.job.adminEmail)}</div>
<div class="muted">Started ${escape(result.startedAt)} · ${(result.durationMs / 1000).toFixed(1)}s · exit ${result.exitCode}</div>

<section class="cards">
  <div class="card"><span>Status</span><strong class="${result.status === "passed" ? "pass" : "fail"}">${escape(result.status)}</strong></div>
  <div class="card"><span>Stages complete</span><strong>${checklist.filter((step) => step.ok).length}/${checklist.length}</strong></div>
  <div class="card"><span>Evaluation</span><strong class="${evaluation?.status === "passed" ? "pass" : evaluation ? "fail" : ""}">${escape(evaluation?.status ?? "not run")}</strong></div>
  <div class="card"><span>Admin report</span><strong class="${adminCsv ? "pass" : ""}">${adminCsv ? "ready" : "—"}</strong></div>
</section>

<h3>Completed tasks</h3>
<ul class="checklist">
  ${checklist
    .map(
      (step) => `<li class="${step.ok ? "done" : "todo"}">
        <span class="tick">${step.ok ? "✓" : "✕"}</span>
        <span>${escape(step.label)}</span>
      </li>`,
    )
    .join("\n")}
</ul>

${failures.length > 0
  ? `<h3>Failures</h3><table><thead><tr><th>Test</th><th>Reason</th></tr></thead><tbody>${failures
      .map(
        (row) =>
          `<tr><td>${escape(row.name)}</td><td><pre>${escape(row.reason || "No reason captured.")}</pre></td></tr>`,
      )
      .join("")}</tbody></table>`
  : result.status === "failed"
    ? `<p><strong>Error:</strong> ${escape(result.error || "Unknown failure.")}</p>`
    : ""}

<h3>Role credentials</h3>
<table><thead><tr><th>Role</th><th>Email</th><th>Password</th></tr></thead><tbody>${credentialTable}</tbody></table>

<div class="links">
  ${adminCsv ? link(path.dirname(result.paths.report), adminCsv, "Admin report CSV") : ""}
  ${adminXlsx ? link(path.dirname(result.paths.report), adminXlsx, "Admin report Excel") : ""}
  ${evaluation?.paths.adminReport ? link(path.dirname(result.paths.report), evaluation.paths.adminReport, "Admin report HTML") : ""}
  ${link(path.dirname(result.paths.report), credentialCsv, "Credentials CSV")}
  <a href="../index.html">All universities</a>
</div>
</main></body></html>`;
}

/**
 * Runs every provisioned university with a bounded pool, then writes the master
 * dashboard, Excel workbook, JSON and Markdown summaries.
 * @param count - Universities to create
 * @param concurrency - Parallel universities
 * @returns Summary written to disk
 */
export async function runUniversityMatrix(
  count: number,
  concurrency: number,
  evaluate = false,
): Promise<MatrixSummary> {
  const tenantPassword = requireEnvironment();
  const startedAt = new Date().toISOString();
  const started = Date.now();

  console.log(
    `\nUNIVERSITY MATRIX — ${count} universities, ${Math.max(1, concurrency)} in parallel\n${"-".repeat(72)}`,
  );
  const jobs = await provisionUniversities(count, concurrency, tenantPassword);
  const results = await mapPool(jobs, Math.max(1, concurrency), (job) =>
    runMatrixJob(job, tenantPassword),
  );

  // Face/liveness needs a real camera and a human, so only the face steps are
  // serialized. As soon as one university's face check clears, its marking and
  // reporting continue in the background while the next window opens.
  if (evaluate) {
    const evaluable = results.filter((result) => result.apiStatus === "passed");
    console.log(
      `\nHEADED EVALUATION — ${evaluable.length} universities; next window opens as soon as the face check clears\n${"-".repeat(72)}`,
    );
    const pending: Promise<void>[] = [];
    for (let index = 0; index < evaluable.length; index += 1) {
      const result = evaluable[index];
      console.log(`\n[${index + 1}/${evaluable.length}] ${result.job.name}`);

      const readyFile = path.join(result.job.dir, "face-ready.flag");
      fs.rmSync(readyFile, { recursive: true, force: true });

      const finished = runEvaluationJob(result.job, tenantPassword).then((phase) => {
        result.evaluation = phase;
        result.status = phase.status === "passed" ? "passed" : "failed";
        if (phase.status !== "passed" && !result.error) result.error = phase.error;
        // Render with the university's `.env` still present, then keep only the
        // result page, credentials and Admin report.
        fs.writeFileSync(result.paths.report, renderUniversityReport(result, tenantPassword));
        cleanupJobArtifacts(result.job);
      });
      pending.push(finished);

      // Move on when this university's face is verified or its run ends early.
      await Promise.race([waitForFile(readyFile), finished]);
    }
    await Promise.all(pending);
  } else {
    for (const result of results) {
      fs.writeFileSync(result.paths.report, renderUniversityReport(result, tenantPassword));
      cleanupJobArtifacts(result.job);
    }
  }

  const summary = aggregate(results, {
    startedAt,
    durationMs: Date.now() - started,
    count,
    concurrency,
    evaluate,
  });
  writeMasterCredentials(summary, tenantPassword);

  console.log(
    `\nUNIVERSITY MATRIX COMPLETE — ${summary.passed} passed, ${summary.failed} failed\n` +
      `  Dashboard: ${summary.paths.index}\n  Excel:     ${summary.paths.xlsx}\n  CSV:       ${summary.paths.csv}\n` +
      (summary.evaluate
        ? `  Evaluated: ${summary.evaluationPassed}/${summary.evaluated}\n`
        : `  Evaluation not run (add --evaluate for Admin report CSV).\n`),
  );
  return summary;
}

/** Builds totals and writes every aggregate artifact. */
function aggregate(
  results: MatrixResult[],
  meta: {
    startedAt: string;
    durationMs: number;
    count: number;
    concurrency: number;
    evaluate: boolean;
  },
): MatrixSummary {
  fs.mkdirSync(MATRIX_DIR, { recursive: true });

  const totals = results.reduce(
    (sum, result) => ({
      total: sum.total + result.totals.total,
      passed: sum.passed + result.totals.passed,
      failed: sum.failed + result.totals.failed,
      skipped: sum.skipped + result.totals.skipped,
    }),
    { total: 0, passed: 0, failed: 0, skipped: 0 },
  );

  const summary: MatrixSummary = {
    startedAt: meta.startedAt,
    durationMs: meta.durationMs,
    count: meta.count,
    concurrency: meta.concurrency,
    passed: results.filter((result) => result.status === "passed").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    evaluate: meta.evaluate,
    evaluated: results.filter((result) => result.evaluation).length,
    evaluationPassed: results.filter((result) => result.evaluation?.status === "passed").length,
    totals,
    results,
    paths: {
      index: path.join(MATRIX_DIR, "index.html"),
      xlsx: path.join(MATRIX_DIR, "summary.xlsx"),
      csv: path.join(MATRIX_DIR, "summary.csv"),
      credentials: path.join(MATRIX_DIR, "credentials.csv"),
      json: path.join(MATRIX_DIR, "summary.json"),
      markdown: path.join(MATRIX_DIR, "summary.md"),
    },
  };

  fs.writeFileSync(summary.paths.index, renderMasterHtml(summary));
  fs.writeFileSync(
    summary.paths.json,
    JSON.stringify(
      {
        ...summary,
        results: results.map((result) => ({
          ...result,
          job: { ...result.job },
          cases: result.cases,
        })),
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(summary.paths.markdown, renderMasterMarkdown(summary));
  writeWorkbook(summary);
  writeMasterCsv(summary);
  return summary;
}

/** Reads the per-university `credentials.csv` that survives cleanup. */
function parseCredentialCsv(file: string): CredentialRow[] {
  if (!fs.existsSync(file)) return [];
  const lines = fs
    .readFileSync(file, "utf-8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  return lines.slice(1).flatMap((line) => {
    const values = (line.match(/"((?:[^"]|"")*)"/g) ?? []).map((cell) =>
      cell.slice(1, -1).replace(/""/g, '"'),
    );
    return values[0] ? [{ role: values[0], email: values[1] ?? "", password: values[2] ?? "" }] : [];
  });
}

/** Writes every university's role logins to the master credentials CSV. */
function writeMasterCredentials(summary: MatrixSummary, tenantPassword: string): void {
  const rows: string[][] = [
    ["#", "University", "Code", "Tenant URL", "Role", "Email", "Password"],
  ];
  for (const result of summary.results) {
    const perJob = parseCredentialCsv(path.join(result.job.dir, "credentials.csv"));
    const credentials = perJob.length > 0 ? perJob : credentialRows(result.job, tenantPassword);
    for (const credential of credentials) {
      rows.push([
        String(result.job.index + 1),
        result.job.name,
        result.job.code,
        result.job.tenantUrl,
        credential.role,
        credential.email,
        credential.password,
      ]);
    }
  }
  const csv = rows
    .map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  fs.writeFileSync(summary.paths.credentials, `\uFEFF${csv}`);
}

/** Writes one CSV row per university, including its Admin report CSV path. */
function writeMasterCsv(summary: MatrixSummary): void {
  const rows: string[][] = [
    [
      "#",
      "University",
      "Code",
      "Tenant URL",
      "Status",
      "API tests passed",
      "API tests total",
      "Evaluation",
      "Admin report CSV",
      "Admin report Excel",
      "Duration (s)",
      "Failure reason",
    ],
  ];
  for (const result of summary.results) {
    const adminCsv = newestFile(
      path.join(result.job.dir, "reports"),
      (name) => name.toLowerCase().endsWith(".csv"),
    );
    const adminXlsx = newestFile(
      path.join(result.job.dir, "reports"),
      (name) => name.toLowerCase().endsWith(".xlsx"),
    );
    rows.push([
      String(result.job.index + 1),
      result.job.name,
      result.job.code,
      result.job.tenantUrl,
      result.status,
      String(result.totals.passed),
      String(result.totals.total),
      result.evaluation?.status ?? "not run",
      adminCsv,
      adminXlsx,
      (result.durationMs / 1000).toFixed(0),
      result.error,
    ]);
  }
  const csv = rows
    .map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  fs.writeFileSync(summary.paths.csv, `\uFEFF${csv}`);
}

/** Renders the cross-university dashboard. */
function renderMasterHtml(summary: MatrixSummary): string {
  const rows = summary.results
    .map((result) => {
      const job = result.job;
      const relativeReport = path.relative(MATRIX_DIR, result.paths.report).replace(/\\/g, "/");
      const adminCsv = newestFile(
        path.join(job.dir, "reports"),
        (name) => name.toLowerCase().endsWith(".csv"),
      );
      const links = [
        `<a href="${escape(relativeReport)}">report</a>`,
        link(MATRIX_DIR, path.join(job.dir, "credentials.csv"), "credentials"),
      ].join(" · ");
      const evaluation = result.evaluation;
      return `<tr class="${result.status}">
        <td class="num">${job.index + 1}</td>
        <td><strong>${escape(job.name)}</strong><div class="muted">${escape(job.code)} · ${escape(job.adminEmail)}</div></td>
        <td>${job.tenantUrl ? `<a href="${escape(job.tenantUrl)}">${escape(job.tenantUrl.replace(/^https?:\/\//, ""))}</a>` : `<span class="muted">not provisioned</span>`}</td>
        <td><span class="pill ${result.status}">${escape(result.status)}</span></td>
        <td class="num">${result.totals.passed}/${result.totals.total}</td>
        <td><span class="pill ${evaluation?.status ?? "skipped"}">${escape(evaluation?.status ?? "not run")}</span></td>
        <td>${adminCsv ? link(MATRIX_DIR, adminCsv, "Admin CSV") : "—"}</td>
        <td class="num">${(result.durationMs / 1000).toFixed(0)}s</td>
        <td class="links">${links}</td>
        <td class="reason">${result.error ? `<pre>${escape(result.error.slice(0, 800))}</pre>` : "—"}</td>
      </tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>University matrix · ${summary.passed}/${summary.results.length} passed</title>
<style>
  :root { --green:#16a34a; --red:#dc2626; --line:#dde3ea; --muted:#5d6b7a; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:"Segoe UI",system-ui,sans-serif; background:#f4f6f8; color:#1c2430; }
  main { max-width:1500px; margin:0 auto; padding:36px 24px 56px; }
  h1 { margin:0 0 6px; font-size:27px; }
  .muted { color:var(--muted); font-size:12px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin:24px 0; }
  .card { background:#fff; border:1px solid var(--line); border-radius:12px; padding:16px 18px; }
  .card span { display:block; color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.06em; }
  .card strong { display:block; margin-top:6px; font-size:26px; }
  .green { color:var(--green); } .red { color:var(--red); }
  .panel { background:#fff; border:1px solid var(--line); border-radius:14px; overflow:auto; }
  table { width:100%; border-collapse:collapse; min-width:1200px; }
  th,td { text-align:left; padding:12px 14px; border-bottom:1px solid #eef1f5; font-size:13px; vertical-align:top; }
  th { background:#f8fafc; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.06em; }
  tr:last-child td { border-bottom:none; }
  .num { font-variant-numeric:tabular-nums; white-space:nowrap; }
  .pill { display:inline-block; padding:4px 10px; border-radius:999px; font-size:11px; font-weight:700; text-transform:uppercase; }
  .pill.passed { background:#e5f6ec; color:#14683a; }
  .pill.failed { background:#fef2f2; color:#991b1b; }
  .pill.skipped { background:#eef1f5; color:#475569; }
  .links { white-space:nowrap; }
  a { color:#1d4ed8; }
  .reason pre { margin:0; white-space:pre-wrap; word-break:break-word; color:#991b1b; background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:8px; font-size:11px; max-height:120px; overflow:auto; }
  .banner { margin-top:18px; padding:14px 18px; border-radius:10px; font-size:14px; background:#fffbeb; border:1px solid #fde68a; color:#92400e; }
  footer { margin-top:18px; font-size:12px; color:var(--muted); }
</style></head><body><main>
<h1>University matrix — ${summary.count} universities</h1>
<div class="muted">${escape(new Date(summary.startedAt).toLocaleString())} · ${summary.concurrency} concurrent · ${(summary.durationMs / 1000).toFixed(0)}s total</div>

<section class="cards">
  <div class="card"><span>Universities passed</span><strong class="green">${summary.passed}/${summary.results.length}</strong></div>
  <div class="card"><span>Universities failed</span><strong class="${summary.failed ? "red" : "green"}">${summary.failed}</strong></div>
  <div class="card"><span>Tests passed</span><strong class="green">${summary.totals.passed}</strong></div>
  <div class="card"><span>Tests failed</span><strong class="${summary.totals.failed ? "red" : "green"}">${summary.totals.failed}</strong></div>
  <div class="card"><span>Tests total</span><strong>${summary.totals.total}</strong></div>
  <div class="card"><span>Duration</span><strong>${(summary.durationMs / 1000).toFixed(0)}s</strong></div>
  ${summary.evaluate ? `<div class="card"><span>Evaluated</span><strong class="green">${summary.evaluationPassed}/${summary.evaluated}</strong></div>` : ""}
</section>

<div class="banner">
  ${summary.evaluate
    ? `Each university first runs the automated API workflow, then a headed evaluation one university at a time:
       face check, marking, moderation, Chairman forwarding and the Admin report (HTML, Excel and CSV).`
    : `Each university runs the automated API workflow through packet submission. Packet allocation, evaluation and the
       evaluation report require the Evaluator face/liveness browser check; run with <code>--evaluate</code> to add the
       headed evaluation phase, which also writes each Admin report as CSV.`}
</div>

<section class="panel" style="margin-top:18px">
  <table>
    <thead><tr><th>#</th><th>University</th><th>Tenant</th><th>Status</th><th>API tests</th><th>Evaluation</th><th>Admin CSV</th><th>Duration</th><th>Artifacts</th><th>Failure reason</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="10" class="muted">No universities were run.</td></tr>`}</tbody>
  </table>
</section>

<footer>Summary: <a href="./summary.xlsx">Excel</a> · <a href="./summary.csv">CSV</a> · <a href="./credentials.csv">All role credentials (CSV)</a> · <a href="./summary.json">JSON</a> · <a href="./summary.md">Markdown</a></footer>
</main></body></html>`;
}

/** Renders the Markdown summary. */
function renderMasterMarkdown(summary: MatrixSummary): string {
  const rows = summary.results.map((result) => {
    const adminCsv = newestFile(
      path.join(result.job.dir, "reports"),
      (name) => name.toLowerCase().endsWith(".csv"),
    );
    return `| ${result.job.index + 1} | ${result.job.name} | ${result.job.code} | ${result.job.tenantUrl || "—"} | ${result.status} | ${result.totals.passed}/${result.totals.total} | ${result.evaluation?.status ?? "not run"} | ${adminCsv || "—"} | ${(result.durationMs / 1000).toFixed(0)}s | ${result.error ? result.error.replace(/\|/g, "\\|").slice(0, 200) : "—"} |`;
  });
  return [
    "# University Matrix Summary",
    "",
    `- Started: ${summary.startedAt}`,
    `- Universities: ${summary.count} (${summary.concurrency} concurrent)`,
    `- Passed: ${summary.passed}, Failed: ${summary.failed}`,
    `- Evaluated (headed): ${summary.evaluated}, passed: ${summary.evaluationPassed}`,
    `- Tests: ${summary.totals.passed} passed, ${summary.totals.failed} failed, ${summary.totals.total} total`,
    `- Duration: ${(summary.durationMs / 1000).toFixed(0)}s`,
    "",
    summary.evaluate
      ? "> API setup runs in parallel, then each university is evaluated one at a time in a headed window"
      : "> The API workflow stops before allocation/evaluation. Run with `--evaluate` for the headed evaluation phase, which writes the Admin report as CSV.",
    summary.evaluate
      ? "> (face check, marking, moderation, Chairman forwarding, Admin report HTML/Excel/CSV)."
      : "> The Evaluator face/liveness check is browser-only and `face/verify-access` returns 409 without it.",
    "",
    "| # | University | Code | Tenant | Status | API tests | Evaluation | Admin CSV | Duration | Reason |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

/** Writes the Excel workbook with one row per university. */
function writeWorkbook(summary: MatrixSummary): void {
  const rows = summary.results.map((result) => ({
    "#": result.job.index + 1,
    University: result.job.name,
    Code: result.job.code,
    "Tenant URL": result.job.tenantUrl,
    "Admin email": result.job.adminEmail,
    Status: result.status,
    "Tests passed": result.totals.passed,
    "Tests failed": result.totals.failed,
    "Tests total": result.totals.total,
    Evaluation: result.evaluation?.status ?? "not run",
    "Admin report CSV":
      newestFile(path.join(result.job.dir, "reports"), (name) =>
        name.toLowerCase().endsWith(".csv"),
      ) || "",
    "Duration (s)": Math.round(result.durationMs / 1000),
    "Failure reason": result.error,
    Report: path.relative(MATRIX_DIR, result.paths.report).replace(/\\/g, "/"),
    "Run log": path.relative(MATRIX_DIR, result.paths.log).replace(/\\/g, "/"),
  }));

  const overview = XLSX.utils.aoa_to_sheet([
    ["Field", "Value"],
    ["Started", summary.startedAt],
    ["Universities", summary.count],
    ["Concurrency", summary.concurrency],
    ["Passed", summary.passed],
    ["Failed", summary.failed],
    ["Evaluated (headed)", summary.evaluated],
    ["Evaluation passed", summary.evaluationPassed],
    ["Tests passed", summary.totals.passed],
    ["Tests failed", summary.totals.failed],
    ["Duration (s)", Math.round(summary.durationMs / 1000)],
    ["Note", summary.evaluate
      ? "API setup plus headed evaluation to the Admin report (HTML, Excel, CSV)."
      : "API workflow through packet submission; run with --evaluate for the headed evaluation and Admin CSV."],
  ]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, overview, "Summary");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Universities");
  XLSX.writeFile(workbook, summary.paths.xlsx);
}
