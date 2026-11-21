#!/usr/bin/env node
/**
 * Reopens the last completed workflow checklist and prints the stored result
 * locations, so the report can be viewed again after the run has finished.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";

const summary = path.resolve(process.cwd(), "docs", "reports", "workflow-summary.html");
if (!fs.existsSync(summary)) {
  console.error("No workflow summary yet. Run `npm run test:platform` first.");
  process.exit(1);
}

const docsDir = path.resolve(process.cwd(), "docs", "reports");
const latestByExtension = (extension) =>
  fs.existsSync(docsDir)
    ? fs
        .readdirSync(docsDir)
        .filter((file) => file.endsWith(extension))
        .map((file) => ({
          file: path.join(docsDir, file),
          modified: fs.statSync(path.join(docsDir, file)).mtimeMs,
        }))
        .sort((left, right) => right.modified - left.modified)[0]?.file
    : undefined;

console.log(`Summary page: ${summary}`);
const workbook = latestByExtension(".xlsx");
const csv = latestByExtension(".csv");
if (workbook) console.log(`Excel report: ${workbook}`);
if (csv) console.log(`CSV report: ${csv}`);

const command =
  process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
const args = process.platform === "win32" ? ["/c", "start", "", summary] : [summary];
spawn(command, args, { detached: true, stdio: "ignore" }).unref();
