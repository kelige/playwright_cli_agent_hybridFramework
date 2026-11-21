import { check, type DefectRecord, type DefectSeverity } from "./defectLog";
import { getCase } from "./caseManifest";

const ROLE_KEYS: Record<string, string> = {
  "Platform Admin": "platform-admin",
  "University Admin": "admin",
  Chairman: "chairman",
  "Chief Examiner": "chief",
  Evaluator: "evaluator",
  "Scanner Operator": "scanner-operator",
  "User Manager": "user-manager",
  "Cross-role / System": "system",
};

/** Defect fields a case may override; role, area and severity default to the CSV row. */
export type CaseDefect = Partial<Omit<DefectRecord, "testCase" | "actual">> & {
  title: string;
  expected: string;
  actual?: string;
};

/**
 * Runs one documented case through the defect-aware check wrapper.
 * The case must exist in the CSV manifest, so a typo can never create untracked coverage.
 * @param id - CSV case ID
 * @param defect - Failure description and optional overrides
 * @param body - Assertions for the case
 * @returns True when the case passed
 */
export async function runCase(
  id: string,
  defect: CaseDefect,
  body: () => Promise<void>,
): Promise<boolean> {
  const row = getCase(id);
  return check(
    id,
    {
      role: defect.role ?? ROLE_KEYS[row.Role] ?? row.Role,
      area: defect.area ?? row.Area,
      severity: (defect.severity ?? row.Severity) as DefectSeverity,
      title: defect.title,
      expected: defect.expected,
      actual: defect.actual,
      test: defect.test,
      evidence: defect.evidence,
    },
    body,
  );
}
