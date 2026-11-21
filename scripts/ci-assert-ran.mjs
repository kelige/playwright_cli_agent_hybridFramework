#!/usr/bin/env node
/**
 * Fails the CI job when Playwright reported no real test execution.
 *
 * A run where every spec skipped its own `test.skip(...)` guard exits 0 and looks
 * green, even though nothing was verified. This script reads JUnit XML and fails
 * when nothing ran, or when every case skipped itself.
 *
 * Accepts a file or a directory tree, because the per-role `testcases` runner
 * writes `reports/testcases/<role>/results.xml` instead of one combined file.
 *
 * Usage:
 *   node scripts/ci-assert-ran.mjs
 *   node scripts/ci-assert-ran.mjs reports/results.xml
 *   node scripts/ci-assert-ran.mjs reports
 */
import fs from "node:fs";
import path from "node:path";

const target = path.resolve(process.cwd(), process.argv[2] ?? "reports/results.xml");
const MIN_EXECUTED = Number(process.env.CI_MIN_EXECUTED ?? 1);

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

if (!fs.existsSync(target)) {
  console.error(`✖ ${target} was not produced, so no test results exist to verify.`);
  process.exit(1);
}

const files = fs.statSync(target).isDirectory() ? collect(target) : [target];
if (files.length === 0) {
  console.error(`✖ No JUnit XML files under ${target}.`);
  process.exit(1);
}

/** Reads one numeric attribute from the JUnit root element. */
function attr(root, name) {
  const match = root.match(new RegExp(`\\b${name}="(\\d+)"`));
  return match ? Number(match[1]) : 0;
}

let total = 0;
let skipped = 0;
for (const file of files) {
  const xml = fs.readFileSync(file, "utf-8");
  const root = xml.match(/<testsuites\b[^>]*>/)?.[0] ?? "";
  total += attr(root, "tests");
  skipped += attr(root, "skipped");
}

const executed = total - skipped;
console.log(
  `JUnit (${files.length} file(s)): ${total} case(s), ${executed} executed, ${skipped} skipped.`,
);

if (total === 0) {
  console.error("✖ No test cases ran. The selected suite matched nothing or the run aborted early.");
  process.exit(1);
}

if (executed < MIN_EXECUTED) {
  console.error(
    `✖ Only ${executed} case(s) actually executed (${skipped} skipped). ` +
      "Every spec skipped its environment guard, so nothing was verified.",
  );
  console.error("  Fill the required .env values (see .env.example) and rerun.");
  process.exit(1);
}

console.log(`✔ ${executed} case(s) executed.`);
