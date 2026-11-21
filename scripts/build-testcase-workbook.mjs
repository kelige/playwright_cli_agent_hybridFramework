#!/usr/bin/env node
/**
 * Builds docs/testcases/DVS-TESTCASES.xlsx from the per-role CSV files.
 * One sheet per CSV; the performance/stress/load suite gets its own sheet.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parse } = require("csv-parse/sync");
const XLSX = require("xlsx");

const dir = path.resolve(process.cwd(), "docs", "testcases");
const sheets = {
  "01-platform-admin.csv": "Platform Admin",
  "02-admin.csv": "University Admin",
  "03-chairman.csv": "Chairman",
  "04-chief-examiner.csv": "Chief Examiner",
  "05-evaluator.csv": "Evaluator",
  "06-scanner-operator.csv": "Scanner Operator",
  "07-user-manager.csv": "User Manager",
  "08-performance-stress-load.csv": "Performance Stress Load",
};

const workbook = XLSX.utils.book_new();

for (const [file, name] of Object.entries(sheets)) {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) {
    console.warn(`missing ${file}`);
    continue;
  }
  const rows = parse(fs.readFileSync(full), { columns: true, skip_empty_lines: true });
  if (rows.length === 0) {
    console.warn(`empty ${file}`);
    continue;
  }
  const header = Object.keys(rows[0]);
  const sheet = XLSX.utils.json_to_sheet(rows, { header });
  XLSX.utils.book_append_sheet(workbook, sheet, name);
  console.log(`${name}: ${rows.length} rows`);
}

const output = path.join(dir, "DVS-TESTCASES.xlsx");
XLSX.writeFile(workbook, output);
console.log(`workbook: ${output}`);
