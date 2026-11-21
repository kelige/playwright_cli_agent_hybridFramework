#!/usr/bin/env node
/**
 * Reopens the latest parallel test-case run summary and prints where each
 * artifact lives.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";

const summary = path.resolve(process.cwd(), "docs", "reports", "testcases-summary.html");
if (!fs.existsSync(summary)) {
  console.error("No test-case summary yet. Run `npm run testcases` first.");
  process.exit(1);
}

console.log(`Summary: ${summary}`);
console.log("Bugs: docs/BUG_DVS.md");
console.log("Reports: reports/testcases/<role>/index.html");
console.log("Dashboards: custom-report/testcases/<role>/index.html");
console.log("Logs: docs/reports/logs/<role>.log");

const command =
  process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
const args = process.platform === "win32" ? ["/c", "start", "", summary] : [summary];
spawn(command, args, { detached: true, stdio: "ignore" }).unref();
