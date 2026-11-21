#!/usr/bin/env node
/**
 * Default test command.
 *
 *   npm test            -> runs the Playwright suite (unchanged)
 *   npm test 100        -> provisions and runs 100 universities in parallel
 *   npm test 200        -> provisions and runs 200 universities in parallel
 *
 * A bare number is treated as the university count and routed to the matrix
 * runner; every other argument is forwarded to Playwright.
 */
import path from "node:path";
import { spawnSync } from "node:child_process";

const cwd = process.cwd();
const args = process.argv.slice(2);
const countArg = args.find((argument) => /^\d+$/.test(argument));

if (countArg) {
  const rest = args.filter((argument) => argument !== countArg);
  const matrix = spawnSync(
    process.execPath,
    [path.join(cwd, "scripts", "run-university-matrix.mjs"), countArg, ...rest],
    { stdio: "inherit", cwd },
  );
  process.exit(matrix.status ?? 1);
}

const cli = path.join(cwd, "node_modules", "playwright", "cli.js");
const result = spawnSync(process.execPath, [cli, "test", ...args], { stdio: "inherit", cwd });
process.exit(result.status ?? 1);
