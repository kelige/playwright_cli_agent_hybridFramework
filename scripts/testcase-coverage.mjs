#!/usr/bin/env node
/**
 * Measures how many documented test cases are actually referenced by an
 * executable Playwright spec.
 *
 * Reads docs/testcases/01..07 CSV files, scans every tests/**\/*.spec.ts for
 * case IDs and ID ranges, and writes:
 *   docs/reports/testcase-coverage.md
 *   docs/reports/testcase-coverage.json
 *
 * `npm run testcases` calls this before each run so the summary shows the
 * completed vs pending gap.
 */
import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parse } = require("csv-parse/sync");

const ROLE_FILES = [
  ["01-platform-admin.csv", "platform-admin", "PAC"],
  ["02-admin.csv", "admin", "ADM"],
  ["03-chairman.csv", "chairman", "CHM"],
  ["04-chief-examiner.csv", "chief-examiner", "CHF"],
  ["05-evaluator.csv", "evaluator", "EVL"],
  ["06-scanner-operator.csv", "scanner-operator", "SCN"],
  ["07-user-manager.csv", "user-manager", "USM"],
];

const dir = path.resolve(process.cwd(), "docs", "testcases");
const reportsDir = path.resolve(process.cwd(), "docs", "reports");
const updateStatus = process.argv.includes("--update-status");
const requireComplete = process.argv.includes("--require-complete");
const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
const dbRunnable = (() => {
  const engine = (process.env.DB_ENGINE ?? "sqlite").trim().toLowerCase();
  if (engine === "sqlite" || engine === "sqlite3") {
    return fs.existsSync(
      path.resolve(process.cwd(), process.env.DB_SQLITE_PATH?.trim() || "prompts/db.sqlite3"),
    );
  }
  return Boolean(process.env.DB_HOST?.trim() && process.env.DB_NAME?.trim());
})();

/**
 * Walks a directory and returns matching files.
 * @param {string} root - Directory to walk
 * @param {(file: string) => boolean} filter - File predicate
 * @returns {string[]} Matching absolute paths
 */
function walk(root, filter) {
  if (!fs.existsSync(root)) return [];
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...walk(full, filter));
    else if (filter(full)) found.push(full);
  }
  return found;
}

/** All spec source text, concatenated. */
const specText = walk(path.resolve(process.cwd(), "tests"), (file) => file.endsWith(".spec.ts"))
  .map((file) => fs.readFileSync(file, "utf-8"))
  .join("\n");

/**
 * Extracts every case number referenced for one prefix, including ranges and
 * slash lists such as `ADM-10..20`, `PAC-06..PAC-11`, `ADM-01/03/04/07`.
 * @param {string} prefix - Case prefix
 * @returns {Set<number>} Referenced case numbers
 */
function references(prefix) {
  const numbers = new Set();
  const addRange = (from, to) => {
    const start = Number(from);
    const end = Number(to);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start < 500) {
      for (let value = start; value <= end; value += 1) numbers.add(value);
    }
  };

  const repeatedRange = new RegExp(`\\b${prefix}-(\\d{1,3})\\s*\\.\\.\\s*${prefix}-(\\d{1,3})\\b`, "g");
  for (const match of specText.matchAll(repeatedRange)) addRange(match[1], match[2]);

  const range = new RegExp(`\\b${prefix}-(\\d{1,3})\\s*\\.\\.\\s*(\\d{1,3})\\b`, "g");
  for (const match of specText.matchAll(range)) addRange(match[1], match[2]);

  const slash = new RegExp(`\\b${prefix}-(\\d{1,3})((?:\\s*\\/\\s*\\d{1,3})+)\\b`, "g");
  for (const match of specText.matchAll(slash)) {
    numbers.add(Number(match[1]));
    for (const part of match[2].split("/")) numbers.add(Number(part.trim()));
  }

  const single = new RegExp(`\\b${prefix}-(\\d{1,3})\\b`, "g");
  for (const match of specText.matchAll(single)) numbers.add(Number(match[1]));

  return numbers;
}

const roles = [];
const pendingRows = [];
let totals = { total: 0, covered: 0, automated: 0, live: 0, blocked: 0, pending: 0 };

for (const [file, role, prefix] of ROLE_FILES) {
  const full = path.join(dir, file);
  const rows = fs.existsSync(full)
    ? parse(fs.readFileSync(full), { columns: true, skip_empty_lines: true })
    : [];
  const coveredNumbers = references(prefix);
  const result = {
    role,
    file,
    prefix,
    total: rows.length,
    covered: 0,
    automated: 0,
    live: 0,
    blocked: 0,
    pending: 0,
    coveragePercent: 0,
  };

  for (const row of rows) {
    const number = Number(new RegExp(`${prefix}-(\\d+)`, "i").exec(row.ID ?? "")?.[1] ?? NaN);
    const referenced = coveredNumbers.has(number);
    const runnable = row["Test Layer"] !== "Database" || dbRunnable;
    const covered = referenced && runnable;
    if (updateStatus) {
      row["Automation Status"] = referenced
        ? runnable
          ? /live\/hitl/i.test(row["Automation Status"] ?? "")
            ? "Live/HITL"
            : "Automated"
          : "Environment blocked"
        : "Automation pending";
    }
    if (covered) {
      result.covered += 1;
      if (/live\/hitl/i.test(row["Automation Status"] ?? "")) result.live += 1;
      else result.automated += 1;
    } else {
      result.pending += 1;
      if (referenced && !runnable) result.blocked += 1;
      pendingRows.push({
        ID: row.ID,
        Role: row.Role,
        Area: row.Area,
        "Test Layer": row["Test Layer"],
        "Test Category": row["Test Category"],
        "Test Type": row["Test Type"],
        Severity: row.Severity,
        Title: row.Title,
        "Automation Status": referenced && !runnable ? "Environment blocked" : row["Automation Status"],
      });
    }
  }
  result.coveragePercent = result.total
    ? Number(((result.covered / result.total) * 100).toFixed(1))
    : 0;
  roles.push(result);

  if (updateStatus && rows.length > 0) {
    const header = Object.keys(rows[0]);
    fs.writeFileSync(
      full,
      [
        header.map(quote).join(","),
        ...rows.map((row) => header.map((key) => quote(row[key])).join(",")),
      ].join("\n") + "\n",
    );
  }

  totals.total += result.total;
  totals.covered += result.covered;
  totals.automated += result.automated;
  totals.live += result.live;
  totals.blocked += result.blocked;
  totals.pending += result.pending;
}

const perfFile = path.join(dir, "08-performance-stress-load.csv");
const perfRows = fs.existsSync(perfFile)
  ? parse(fs.readFileSync(perfFile), { columns: true, skip_empty_lines: true })
  : [];
const perfTotal = perfRows.length;
for (const row of perfRows) {
  pendingRows.push({
    ID: row.ID,
    Role: row.Scope,
    Area: row.Area,
    "Test Layer": "Cross-layer",
    "Test Category": "Non-Functional",
    "Test Type": row["Test Type"],
    Severity: row.Severity,
    Title: row.Title,
    "Automation Status": row["Automation Status"],
  });
}

const grand = {
  ...totals,
  performance: perfTotal,
  performanceAutomated: 0,
  allDocumented: totals.total + perfTotal,
  allCovered: totals.covered,
  coveragePercent: totals.total
    ? Number(((totals.covered / totals.total) * 100).toFixed(1))
    : 0,
  allCoveragePercent: totals.total + perfTotal
    ? Number(((totals.covered / (totals.total + perfTotal)) * 100).toFixed(1))
    : 0,
};

const pendingHeader = [
  "ID",
  "Role",
  "Area",
  "Test Layer",
  "Test Category",
  "Test Type",
  "Severity",
  "Title",
  "Automation Status",
];
fs.mkdirSync(reportsDir, { recursive: true });
fs.writeFileSync(
  path.join(reportsDir, "testcase-pending.csv"),
  [
    pendingHeader.map(quote).join(","),
    ...pendingRows.map((row) => pendingHeader.map((key) => quote(row[key])).join(",")),
  ].join("\n") + "\n",
);

const payload = {
  generatedAt: new Date().toISOString(),
  grand,
  roles,
  pendingFile: "docs/reports/testcase-pending.csv",
};
fs.writeFileSync(
  path.join(reportsDir, "testcase-coverage.json"),
  JSON.stringify(payload, null, 2),
);

const table = [
  "| Role | Documented | Covered by a spec | Automated | Live/HITL | Blocked | Pending | Coverage |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...roles.map(
    (row) =>
      `| ${row.role} | ${row.total} | ${row.covered} | ${row.automated} | ${row.live} | ${row.blocked} | ${row.pending} | ${row.coveragePercent}% |`,
  ),
  `| **Role total** | **${totals.total}** | **${totals.covered}** | **${totals.automated}** | **${totals.live}** | **${totals.blocked}** | **${totals.pending}** | **${grand.coveragePercent}%** |`,
  `| Performance/Stress/Load | ${perfTotal} | 0 | 0 | 0 | 0 | ${perfTotal} | 0% |`,
  `| **All documented** | **${grand.allDocumented}** | **${grand.allCovered}** | **${totals.automated}** | **${totals.live}** | **${totals.blocked}** | **${totals.pending + perfTotal}** | **${grand.allCoveragePercent}%** |`,
  "",
  "Blocked = the spec exists but its environment is not configured (for example DB credentials).",
  "Pending backlog: `docs/reports/testcase-pending.csv`.",
].join("\n");

const markdown = [
  "# Test Case Automation Coverage",
  "",
  `Generated: ${payload.generatedAt}`,
  "",
  "Coverage counts a case as covered when its ID (or an ID range) is referenced by a spec.",
  "`Automation pending` cases are documented and ready to automate, but not executed yet.",
  "",
  table,
  "",
].join("\n");

fs.writeFileSync(path.join(reportsDir, "testcase-coverage.md"), markdown);

if (!process.argv.includes("--quiet")) {
  console.log(`\nTEST CASE COVERAGE`);
  console.log(table);
  console.log(`\nReports: docs/reports/testcase-coverage.md / .json`);
  console.log(`Pending: docs/reports/testcase-pending.csv\n`);
}

if (requireComplete && grand.pending + grand.performance > 0) {
  console.error(
    `INCOMPLETE: ${grand.pending + grand.performance} documented case(s) still need automation.`,
  );
  process.exit(1);
}
