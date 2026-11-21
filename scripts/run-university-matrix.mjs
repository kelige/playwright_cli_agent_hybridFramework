#!/usr/bin/env node
/**
 * Creates and runs many universities in parallel.
 *
 * `npm run test:matrix` provisions 100 universities on the platform control
 * plane (10 at a time) and drives each one through the automated API workflow
 * in its own child process. Every university gets isolated credentials,
 * runtime state, reports and logs, and the run finishes with a master
 * dashboard at docs/reports/university-matrix/index.html.
 *
 * Options:
 *   --count=<n>             Universities to create (default 100, or DVS_MATRIX_COUNT)
 *   --concurrency=<n>       Parallel universities (default 10, or DVS_MATRIX_CONCURRENCY)
 *   --allow-failures        Do not fail the command when a university fails
 *   ...                     Any other argument is forwarded to Playwright
 *
 * The automated API workflow covers provisioning through packet submission.
 * Allocation, evaluation and the evaluation report need the Evaluator
 * face/liveness browser check; the run reports those stages as not executed.
 */
import path from "node:path";
import { spawnSync } from "node:child_process";

const cwd = process.cwd();
const args = process.argv.slice(2);
const valueOf = (name) =>
  args.find((argument) => argument.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
// A bare number is the university count: `node run-university-matrix.mjs 200`.
const positionalCount = args.find((argument) => /^\d+$/.test(argument));

const requestedCount = Number(
  valueOf("count") ?? positionalCount ?? process.env.DVS_MATRIX_COUNT ?? 100,
);
const requestedConcurrency = Number(
  valueOf("concurrency") ?? process.env.DVS_MATRIX_CONCURRENCY ?? 10,
);
const count = Number.isFinite(requestedCount) && requestedCount > 0 ? Math.floor(requestedCount) : 100;
const concurrency =
  Number.isFinite(requestedConcurrency) && requestedConcurrency > 0
    ? Math.floor(requestedConcurrency)
    : 10;
const allowFailures = args.includes("--allow-failures");
// Adds the headed, one-at-a-time evaluation phase and writes the Admin report
// as CSV/Excel/HTML for every university.
// Bare `evaluate` works because npm reserves `--flags` for itself unless they
// come after `--`. So both are accepted:
//   npm run test:platform 100 evaluate
//   npm run test:platform 100 -- --evaluate
const evaluate = args.includes("--evaluate") || args.includes("evaluate");
// Skips the four deliberately-failing checks (5.2, 5.4, 6.2, 8.1).
const fast = args.includes("--fast") || args.includes("fast");
// Keep logs, Playwright reports, run state and dashboards for debugging.
const keepFiles = args.includes("--keep-files") || args.includes("keep-files");

const extra = args.filter(
  (argument) =>
    !/^\d+$/.test(argument) &&
    !argument.startsWith("--count=") &&
    !argument.startsWith("--concurrency=") &&
    argument !== "--allow-failures" &&
    argument !== "--evaluate" &&
    argument !== "evaluate" &&
    argument !== "--fast" &&
    argument !== "fast" &&
    argument !== "--keep-files" &&
    argument !== "keep-files",
);

const env = {
  ...process.env,
  DVS_MATRIX_COUNT: String(count),
  DVS_MATRIX_CONCURRENCY: String(concurrency),
  DVS_MATRIX_ALLOW_FAILURES: allowFailures ? "true" : process.env.DVS_MATRIX_ALLOW_FAILURES ?? "false",
  DVS_MATRIX_EVALUATE: evaluate ? "true" : process.env.DVS_MATRIX_EVALUATE ?? "false",
  DVS_MATRIX_FAST: fast ? "true" : process.env.DVS_MATRIX_FAST ?? "false",
  DVS_MATRIX_KEEP_FILES: keepFiles ? "true" : process.env.DVS_MATRIX_KEEP_FILES ?? "false",
};

console.log(
  `\nUNIVERSITY MATRIX\n  Universities: ${count}\n  Concurrency:  ${concurrency}\n${"-".repeat(72)}`,
);

const cli = path.join(cwd, "node_modules", "playwright", "cli.js");
const result = spawnSync(
  process.execPath,
  [cli, "test", "--project=matrix", "--workers=1", ...extra],
  { cwd, env, stdio: "inherit" },
);

process.exit(result.status ?? 1);
