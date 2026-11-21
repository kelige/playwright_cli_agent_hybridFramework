#!/usr/bin/env node
/**
 * Runs the platform bootstrap workflow.
 *
 * `npm run test:platform` provisions one university and runs the single
 * workflow. `npm run test:platform 100` provisions and runs 100 universities in
 * parallel (10 at a time) through the matrix runner.
 *
 * A single run provisions a brand-new university on every run:
 * the platform control plane creates the tenant and administrator, and the
 * bootstrap consumes the one-time handover immediately. No manual step and no
 * pre-existing tenant are involved, so the run always starts from a clean tenant.
 *
 * The whole end-to-end flow is chained unless `--bootstrap-only` is passed, so a
 * single command takes the freshly provisioned university from Admin creation to
 * the Admin receiving the evaluation report.
 */
import path from "node:path";
import { spawnSync } from "node:child_process";

const forwarded = process.argv.slice(2);

// `npm run test:platform 100` (or test:platform-100) means many universities.
const countArg = forwarded.find((argument) => /^\d+$/.test(argument));
if (countArg) {
  const rest = forwarded.filter((argument) => argument !== countArg);
  const matrix = spawnSync(
    process.execPath,
    [path.join(process.cwd(), "scripts", "run-university-matrix.mjs"), countArg, ...rest],
    { stdio: "inherit", cwd: process.cwd() },
  );
  process.exit(matrix.status ?? 1);
}

const bootstrapOnly = forwarded.includes("--bootstrap-only");
const extra = forwarded.filter((argument) => argument !== "--bootstrap-only");

/** Runs one Playwright project and returns its exit code. */
function runProject(project, args) {
  return (
    spawnSync("npx", ["playwright", "test", `--project=${project}`, ...args], {
      stdio: "inherit",
      shell: true,
      // `npx` resets npm_lifecycle_event, so the workflow project would not be
      // defined in the child run. The flag makes the project available explicitly.
      env: { ...process.env, DVS_LIVE_WORKFLOW: "true" },
    }).status ?? 1
  );
}

const bootstrap = runProject("platform", extra);
if (bootstrap !== 0) process.exit(bootstrap);
if (bootstrapOnly) process.exit(0);

const workflow = runProject("workflow", extra);
process.exit(workflow);
