import * as fs from "node:fs";
import * as path from "node:path";
import { getCase } from "./caseManifest";

/** Severity of a recorded defect. */
export type DefectSeverity = "S1" | "S2" | "S3" | "S4";

/** One defect observed by a test-case suite. */
export type DefectRecord = {
  role: string;
  area: string;
  testCase: string;
  severity: DefectSeverity;
  title: string;
  expected: string;
  actual: string;
  test?: string;
  evidence?: string;
};

const DEFECT_FILE = path.resolve(
  process.cwd(),
  process.env.DVS_DEFECT_FILE?.trim() || path.join("docs", "BUG_DVS.md"),
);
const CASE_RESULTS_FILE = path.resolve(
  process.cwd(),
  process.env.CASE_RESULTS_JSONL?.trim() ||
    path.join("docs", "reports", "test-results.cases.jsonl"),
);

/**
 * Appends one case-level pass/fail record so the end-of-run reporter can show a
 * green tick or the exact failure reason for every case, even when the parent
 * Playwright test continues after a recorded defect.
 */
function recordCase(
  testCase: string,
  status: "passed" | "failed",
  reason: string,
): void {
  let title = testCase;
  try {
    title = getCase(testCase).Title;
  } catch {
    // Ranges and legacy IDs are not individual manifest rows.
  }
  try {
    fs.mkdirSync(path.dirname(CASE_RESULTS_FILE), { recursive: true });
    fs.appendFileSync(
      CASE_RESULTS_FILE,
      `${JSON.stringify({ case: testCase, title, status, reason: plain(reason) })}\n`,
    );
  } catch {
    // Reporting must never break the test run.
  }
}

/** Removes terminal colour codes so the log stays readable Markdown. */
function plain(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

/**
 * Appends one defect record to `docs/BUG_DVS.md`.
 * A defect never fails the run: the caller records it and continues to the next
 * test case, so one broken outcome cannot hide the rest of the role.
 * @param defect - Observed defect
 * @returns The generated defect id
 */
export function recordDefect(defect: DefectRecord): string {
  const id = `DVS-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;
  const timestamp = new Date().toISOString();
  const tenant = (process.env.WEB_APP_URL ?? "").replace(/\/+$/, "") || "(not configured)";
  const actual = plain(defect.actual);

  const block = [
    "",
    `### ${id} — ${defect.title}`,
    "",
    `- Date: ${timestamp}`,
    `- Role: ${defect.role}`,
    `- Area: ${defect.area}`,
    `- Severity: ${defect.severity}`,
    `- Test case: ${defect.testCase}`,
    `- Environment: ${tenant}`,
    `- Reproduce: ${defect.test ?? "(see suite output)"}`,
    `- Expected: ${defect.expected}`,
    `- Actual: ${actual}`,
    `- Evidence: ${defect.evidence ?? "(none captured)"}`,
    "- Status: Open",
    "",
  ].join("\n");

  if (!fs.existsSync(DEFECT_FILE)) {
    fs.mkdirSync(path.dirname(DEFECT_FILE), { recursive: true });
    fs.writeFileSync(DEFECT_FILE, "# BUG_DVS — Defect Log\n");
  }

  // A rerun must not create a second record for the same open defect.
  const existingText = fs.readFileSync(DEFECT_FILE, "utf-8");
  const existingMatches = [...existingText.matchAll(/^### (DVS-\S+) — (.+)$/gm)];
  for (let index = 0; index < existingMatches.length; index += 1) {
    const match = existingMatches[index];
    const next = existingMatches[index + 1];
    const existingBlock = existingText.slice(match.index, next ? next.index : existingText.length);
    const field = (label: string) =>
      String(new RegExp(`^- ${label}: (.*)$`, "m").exec(existingBlock)?.[1] ?? "").trim();
    if (
      match[2] === defect.title &&
      field("Role") === defect.role &&
      field("Test case") === defect.testCase
    ) {
      console.log(`DEFECT ${match[1]} already recorded — continuing`);
      return match[1];
    }
  }

  fs.appendFileSync(DEFECT_FILE, block);

  console.log(
    `\n⚠️  DEFECT ${id} [${defect.severity}] ${defect.role} / ${defect.testCase}: ${defect.title}\n` +
      `   expected: ${defect.expected}\n   actual:   ${defect.actual}\n` +
      "   recorded in docs/BUG_DVS.md — continuing with the remaining test cases\n",
  );
  return id;
}

/**
 * Runs one assertion block and records a defect instead of aborting the suite.
 * The happy path is unchanged; a failing check is reported and the suite moves on
 * to the next test case.
 * @param testCase - Test case id from `docs/testcases/`
 * @param defect - Defect details without the id
 * @param body - The check to run
 * @returns True when the check passed
 */
export async function check(
  testCase: string,
  defect: Omit<DefectRecord, "testCase" | "actual"> & { actual?: string },
  body: () => Promise<void>,
): Promise<boolean> {
  try {
    await body();
    recordCase(testCase, "passed", "");
    return true;
  } catch (error) {
    const actual = defect.actual ?? (error instanceof Error ? error.message : String(error));
    recordCase(testCase, "failed", actual);
    recordDefect({ ...defect, testCase, actual });
    return false;
  }
}
