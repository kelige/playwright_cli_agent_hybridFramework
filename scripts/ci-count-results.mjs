#!/usr/bin/env node
/**
 * Writes pass/fail/skip counts to `ci-counts.env` so the Jenkins email can show
 * what was actually verified instead of only the build result.
 *
 * Reads the same JUnit XML that `ci-assert-ran.mjs` validates, and accepts a
 * file or a directory because the per-role `testcases` runner writes one file
 * per role.
 *
 * Usage:
 *   node scripts/ci-count-results.mjs
 *   node scripts/ci-count-results.mjs reports/results.xml
 */
import fs from "node:fs";
import path from "node:path";

const target = path.resolve(process.cwd(), process.argv[2] ?? "reports/results.xml");
const output = path.resolve(process.cwd(), "ci-counts.env");

/** Collects every JUnit XML file under a path. */
function collect(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...collect(full));
    else if (entry.name.endsWith(".xml")) found.push(full);
  }
  return found;
}

/** Reads one numeric attribute from the JUnit root element. */
function attr(root, name) {
  const match = root.match(new RegExp(`\\b${name}="(\\d+)"`));
  return match ? Number(match[1]) : 0;
}

let total = 0;
let skipped = 0;
let failed = 0;
let errors = 0;

if (fs.existsSync(target)) {
  const files = fs.statSync(target).isDirectory() ? collect(target) : [target];
  for (const file of files) {
    const root = fs.readFileSync(file, "utf-8").match(/<testsuites\b[^>]*>/)?.[0] ?? "";
    total += attr(root, "tests");
    skipped += attr(root, "skipped");
    failed += attr(root, "failures");
    errors += attr(root, "errors");
  }
}

failed += errors;
const passed = Math.max(0, total - skipped - failed);

fs.writeFileSync(output, `TOTAL=${total}\nPASSED=${passed}\nFAILED=${failed}\nSKIPPED=${skipped}\n`);
console.log(`TOTAL=${total} PASSED=${passed} FAILED=${failed} SKIPPED=${skipped} -> ci-counts.env`);
