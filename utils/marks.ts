import * as fs from "node:fs";
import * as path from "node:path";

/** One captured mark row keyed by question number. */
export type MarkRow = {
  questionNumber: number;
  maxMarks: number;
  awardedMarks: number;
  outcome: string;
  adjustment: string;
  requiresAttention: boolean;
  examinerConfirmed: boolean;
};

type MarksFile = {
  validMarks: MarkRow[];
  expectedTotals?: Record<string, number>;
};

const MARKS_FILE = path.resolve(process.cwd(), "testdata", "dvs_marks.json");

/** Reads the captured marks file. */
export function loadMarksFile(): MarksFile {
  return JSON.parse(fs.readFileSync(MARKS_FILE, "utf-8")) as MarksFile;
}

/**
 * Per-university marks seed. The matrix sets one per university so every
 * evaluated script gets different marks instead of the same full-mark script.
 * @returns A stable number, or 0 for the captured reference marks
 */
export function marksSeed(): number {
  const raw = process.env.DVS_MARKS_SEED?.trim();
  if (!raw) return 0;
  let hash = 2166136261;
  for (const character of raw) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic 0..1 value for a seed, question and salt. */
function random(seed: number, question: number, salt: number): number {
  let value =
    (seed ^ Math.imul(question + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

/**
 * Varies one question's award for a university: some questions are left
 * unanswered and answered ones score 35–90% of the maximum, so totals differ
 * between scripts and nobody receives full marks on everything.
 * @param row - Captured reference row
 * @param seed - Per-university seed; 0 keeps the reference marks
 */
export function applyMarkVariation(row: MarkRow, seed: number): MarkRow {
  const max = Number(row.maxMarks) || 0;
  if (seed === 0 || max <= 0) return row;

  if (random(seed, row.questionNumber, 1) < 0.12) {
    return { ...row, awardedMarks: 0, outcome: "unanswered" };
  }
  const ratio = 0.35 + 0.55 * random(seed, row.questionNumber, 2);
  const awarded = Math.min(max, Math.max(0, Math.round(max * ratio)));
  return { ...row, awardedMarks: awarded, outcome: awarded > 0 ? "evaluated" : "unanswered" };
}

/**
 * Returns this run's mark rows, varied per university when a seed is present.
 * @param seed - Defaults to `DVS_MARKS_SEED`
 */
export function variedMarks(seed = marksSeed()): MarkRow[] {
  return loadMarksFile().validMarks.map((row) => applyMarkVariation(row, seed));
}
