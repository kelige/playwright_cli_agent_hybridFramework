import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "csv-parse/sync";

/** One documented test case, normalized across the role and performance CSVs. */
export type TestCaseRow = {
  ID: string;
  Role: string;
  Area: string;
  TestLayer: string;
  ExecutionMode: string;
  TestCategory: string;
  TestType: string;
  Severity: string;
  Title: string;
  Preconditions: string;
  Steps: string;
  Expected: string;
  TestData: string;
  AutomationStatus: string;
  Notes: string;
  SourceFile: string;
};

const CASE_DIR = path.resolve(process.cwd(), "docs", "testcases");
const FILES = [
  "01-platform-admin.csv",
  "02-admin.csv",
  "03-chairman.csv",
  "04-chief-examiner.csv",
  "05-evaluator.csv",
  "06-scanner-operator.csv",
  "07-user-manager.csv",
  "08-performance-stress-load.csv",
] as const;
const REQUIRED = [
  "ID",
  "Role",
  "Area",
  "Test Layer",
  "Execution Mode",
  "Test Category",
  "Test Type",
  "Severity",
  "Title",
  "Preconditions",
  "Steps",
  "Expected Result",
  "Test Data",
  "Automation Status",
  "Notes",
] as const;
const PERF_REQUIRED = [
  "ID",
  "Scope",
  "Area",
  "Test Type",
  "Workload",
  "Persona",
  "Severity",
  "Title",
  "Preconditions",
  "Steps",
  "Success Criteria",
  "Test Data",
  "Environment",
  "Automation Status",
  "Notes",
] as const;

let cache: Map<string, TestCaseRow> | undefined;

/**
 * Reads the performance CSV, whose columns describe a workload rather than a
 * role layer, into the common case shape.
 */
function normalizePerformanceRow(row: Record<string, string>, file: string): TestCaseRow {
  return {
    ID: row.ID,
    Role: row.Scope,
    Area: row.Area,
    TestLayer: "Cross-layer",
    ExecutionMode: "Automated",
    TestCategory: "Non-Functional",
    TestType: row["Test Type"],
    Severity: row.Severity,
    Title: row.Title,
    Preconditions: row.Preconditions,
    Steps: row.Steps,
    Expected: row["Success Criteria"],
    TestData: row["Test Data"],
    AutomationStatus: row["Automation Status"],
    Notes: row.Notes,
    SourceFile: file,
  };
}

/**
 * Loads and validates every documented case.
 * @returns Case map keyed by case ID
 */
export function loadCases(): Map<string, TestCaseRow> {
  if (cache) return cache;

  const cases = new Map<string, TestCaseRow>();
  for (const file of FILES) {
    const full = path.join(CASE_DIR, file);
    if (!fs.existsSync(full)) throw new Error(`Test case file is missing: ${full}`);
    const rows = parse(fs.readFileSync(full), {
      columns: true,
      skip_empty_lines: true,
    }) as Record<string, string>[];

    for (const row of rows) {
      const required = file === "08-performance-stress-load.csv" ? PERF_REQUIRED : REQUIRED;
      for (const column of required) {
        if (!(column in row)) {
          throw new Error(`${file}:${row.ID ?? "?"} is missing column "${column}".`);
        }
      }

      const normalized =
        file === "08-performance-stress-load.csv"
          ? normalizePerformanceRow(row, file)
          : {
              ID: row.ID,
              Role: row.Role,
              Area: row.Area,
              TestLayer: row["Test Layer"],
              ExecutionMode: row["Execution Mode"],
              TestCategory: row["Test Category"],
              TestType: row["Test Type"],
              Severity: row.Severity,
              Title: row.Title,
              Preconditions: row.Preconditions,
              Steps: row.Steps,
              Expected: row["Expected Result"],
              TestData: row["Test Data"],
              AutomationStatus: row["Automation Status"],
              Notes: row.Notes,
              SourceFile: file,
            };

      if (cases.has(normalized.ID)) {
        throw new Error(`Duplicate test case ID: ${normalized.ID}`);
      }
      cases.set(normalized.ID, normalized);
    }
  }

  cache = cases;
  return cache;
}

/**
 * Returns one case or throws when the ID is not documented.
 * @param id - Case ID such as ADM-120
 */
export function getCase(id: string): TestCaseRow {
  const row = loadCases().get(id);
  if (!row) throw new Error(`Unknown test case ID "${id}".`);
  return row;
}

/** Cases for one role, in file order. */
export function casesByRole(role: string): TestCaseRow[] {
  return [...loadCases().values()].filter((row) => row.Role === role);
}

/** Cases for one layer (`UI`, `API`, `Database`, `Cross-layer`). */
export function casesByLayer(layer: string): TestCaseRow[] {
  return [...loadCases().values()].filter((row) => row.TestLayer === layer);
}

/** Total number of documented cases. */
export function caseCount(): number {
  return loadCases().size;
}
