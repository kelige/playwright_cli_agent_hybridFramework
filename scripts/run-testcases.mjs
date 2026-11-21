#!/usr/bin/env node
/**
 * Runs every per-role test-case suite with one command.
 *
 * `npm run testcases`
 *
 * Roles run in dependency-aware parallel waves:
 *   1) platform-admin + admin       (control plane and shared policy)
 *   2) chairman + chief + user-manager + scanner-operator + evaluator
 *
 * Each role gets isolated report folders, log and defect file, so parallel
 * processes never overwrite or interleave each other. Defects are merged into
 * docs/BUG_DVS.md at the end and a presentation summary is written to
 * docs/reports/testcases-summary.html.
 *
 * Options:
 *   --role=<role>          Run one role only
 *   --max-parallel=<n>     Parallel roles per wave (default 4, or TESTCASE_MAX_PARALLEL)
 *   --no-open              Do not open the HTML summary when finished
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";

const cwd = process.cwd();
const args = process.argv.slice(2);
const only = args.find((argument) => argument.startsWith("--role="))?.split("=")[1];
const parallelArg = args.find((argument) => argument.startsWith("--max-parallel="));
const requestedParallel = Number(
  parallelArg?.split("=")[1] || process.env.TESTCASE_MAX_PARALLEL || 4,
);
const maxParallel =
  Number.isFinite(requestedParallel) && requestedParallel > 0
    ? Math.max(1, Math.floor(requestedParallel))
    : 4;
const noOpen = args.includes("--no-open");
const extra = args.filter(
  (argument) =>
    !argument.startsWith("--role=") &&
    !argument.startsWith("--max-parallel=") &&
    argument !== "--no-open",
);

const ORDER = [
  "platform-admin",
  "admin",
  "chairman",
  "chief",
  "user-manager",
  "scanner-operator",
  "evaluator",
];
const WAVES = [
  ["platform-admin", "admin"],
  ["chairman", "chief", "user-manager", "scanner-operator", "evaluator"],
];

const REPORT_ROOT = path.join("reports", "testcases");
const CUSTOM_ROOT = path.join("custom-report", "testcases");
const DEFECT_ROOT = path.join("docs", "reports", "defects");
const LOG_ROOT = path.join("docs", "reports", "logs");

if (only && !ORDER.includes(only)) {
  console.error(`Unknown role "${only}". Use one of: ${ORDER.join(", ")}`);
  process.exit(2);
}

const selected = only ? [only] : ORDER;
const waves = (only ? [[only]] : WAVES).map((wave) =>
  wave.filter((role) => selected.includes(role)),
);
const planned = new Set(waves.flat());
const leftovers = selected.filter((role) => !planned.has(role));
if (leftovers.length > 0) waves.push(leftovers);

for (const directory of [REPORT_ROOT, CUSTOM_ROOT, DEFECT_ROOT, LOG_ROOT]) {
  fs.rmSync(path.join(cwd, directory), { recursive: true, force: true });
}

// Refresh the documented-vs-executable coverage before the run.
let coverage = null;
try {
  execFileSync(process.execPath, [path.join(cwd, "scripts", "testcase-coverage.mjs"), "--quiet"], {
    cwd,
    stdio: "ignore",
  });
  const coverageFile = path.join(cwd, "docs", "reports", "testcase-coverage.json");
  if (fs.existsSync(coverageFile)) coverage = JSON.parse(fs.readFileSync(coverageFile, "utf-8"));
} catch {
  coverage = null;
}

const formatDuration = (ms) => {
  const seconds = Math.round(ms / 1000);
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`
    : `${seconds}s`;
};
const exists = (file) => fs.existsSync(path.join(cwd, file));
const defectCount = (file) => {
  const full = path.join(cwd, file);
  if (!fs.existsSync(full)) return 0;
  return (fs.readFileSync(full, "utf-8").match(/^### DVS-/gm) ?? []).length;
};
const defectDetails = (file) => {
  const full = path.join(cwd, file);
  if (!fs.existsSync(full)) return [];
  const text = fs.readFileSync(full, "utf-8");
  return [...text.matchAll(/^### (DVS-\S+) — (.+)$/gm)].map((match) => {
    const block = text.slice(match.index);
    return {
      id: match[1],
      title: match[2],
      severity: String(/^- Severity: (.*)$/m.exec(block)?.[1] ?? "").trim(),
    };
  });
};
const escape = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Runs one role in its own Playwright process and captures its log.
 * @param {string} role - Role suite key
 * @returns {Promise<object>} Role result
 */
function runRole(role) {
  return new Promise((resolve) => {
    const started = Date.now();
    const logFile = path.join(LOG_ROOT, `${role}.log`);
    const defectFile = path.join(DEFECT_ROOT, `${role}.md`);
    const reportFile = path.join(REPORT_ROOT, role, "index.html");
    const customFile = path.join(CUSTOM_ROOT, role, "index.html");
    const junitFile = path.join(REPORT_ROOT, role, "results.xml");
    const logPath = path.join(cwd, logFile);

    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.mkdirSync(path.join(cwd, REPORT_ROOT, role), { recursive: true });
    const log = fs.createWriteStream(logPath);
    log.write(`# Role: ${role}\n# Started: ${new Date().toISOString()}\n\n`);

    console.log(`START  ${role}`);

    const playwrightCli = path.join(cwd, "node_modules", "playwright", "cli.js");
    const child = spawn(
      process.execPath,
      [
        playwrightCli,
        "test",
        "--project=testcases",
        "--project=testcases-api",
        "--project=testcases-db",
        "--grep",
        `@${role}`,
        "--headed",
        "--workers=1",
        `--output=test-results/testcases/${role}`,
        ...extra,
      ],
      {
        cwd,
        env: {
          ...process.env,
          PW_REPORT_DIR: path.join(REPORT_ROOT, role),
          PW_JUNIT_FILE: path.join(REPORT_ROOT, role, "results.xml"),
          CUSTOM_REPORT_DIR: path.join(CUSTOM_ROOT, role),
          CASE_RESULTS_FILE: path.join("docs", "reports", "testcase-results", `${role}.html`),
          CASE_RESULTS_JSONL: path.join("docs", "reports", "testcase-results", `${role}.cases.jsonl`),
          CASE_RESULTS_OPEN: "false",
          DVS_DEFECT_FILE: defectFile,
        },
      },
    );

    child.stdout.on("data", (chunk) => log.write(chunk));
    child.stderr.on("data", (chunk) => log.write(chunk));
    child.on("error", (error) => log.write(`\nSpawn error: ${error.message}\n`));

    child.on("close", (code) => {
      const duration = Date.now() - started;
      const defects = defectCount(defectFile);
      const details = defectDetails(defectFile);
      const status = (code ?? 1) === 0 && defects === 0 ? "PASS" : "FAIL";
      log.write(`\n# Finished: ${new Date().toISOString()}\n# Exit: ${code}\n# Defects: ${defects}\n`);
      log.end();

      console.log(
        `${status.padEnd(6)} ${role} (${formatDuration(duration)}, ${defects} defect${
          defects === 1 ? "" : "s"
        })`,
      );

      resolve({
        role,
        status,
        exitCode: code ?? 1,
        defects,
        defectDetails: details,
        duration,
        log: logFile,
        defectFile,
        report: exists(reportFile) ? reportFile : "",
        customReport: exists(customFile) ? customFile : "",
        junit: exists(junitFile) ? junitFile : "",
      });
    });
  });
}

/**
 * Runs roles with a bounded parallel pool.
 * @param {string[]} roles - Roles in this wave
 * @returns {Promise<object[]>} Role results
 */
async function runPool(roles) {
  const queue = [...roles];
  const results = [];
  const workers = Array.from({ length: Math.min(maxParallel, roles.length) }, async () => {
    while (queue.length > 0) {
      const role = queue.shift();
      results.push(await runRole(role));
    }
  });
  await Promise.all(workers);
  return results;
}

const startedAt = Date.now();
const results = [];
for (const wave of waves) {
  if (wave.length === 0) continue;
  const parallel = wave.length > 1 ? ` (parallel x${Math.min(maxParallel, wave.length)})` : "";
  console.log(`\nWAVE ${wave.join(" + ")}${parallel}\n${"-".repeat(72)}`);
  results.push(...(await runPool(wave)));
}

results.sort((left, right) => ORDER.indexOf(left.role) - ORDER.indexOf(right.role));

const caseResults = [];
for (const result of results) {
  const file = path.join(cwd, "docs", "reports", "testcase-results", `${result.role}.json`);
  if (!fs.existsSync(file)) continue;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    for (const row of data.results ?? []) caseResults.push({ role: result.role, ...row });
  } catch {
    // A missing/invalid per-role result file must not break the summary.
  }
}
const casePassed = caseResults.filter((row) => row.status === "passed").length;
const caseFailed = caseResults.filter((row) => row.status === "failed").length;
const caseSkipped = caseResults.filter((row) => row.status === "skipped").length;

// Merge this run's per-role defect files into the durable log.
const bugLog = path.join(cwd, "docs", "BUG_DVS.md");
if (!fs.existsSync(bugLog)) fs.writeFileSync(bugLog, "# BUG_DVS — Defect Log\n");

const fingerprint = (block, title) => {
  const field = (label) => String(new RegExp(`^- ${label}: (.*)$`, "m").exec(block)?.[1] ?? "").trim();
  return `${field("Role")}|${field("Test case")}|${title}`;
};
const existingFingerprints = new Set();
const existingText = fs.readFileSync(bugLog, "utf-8");
const existingMatches = [...existingText.matchAll(/^### (DVS-\S+) — (.+)$/gm)];
for (let index = 0; index < existingMatches.length; index += 1) {
  const match = existingMatches[index];
  const next = existingMatches[index + 1];
  const block = existingText.slice(match.index, next ? next.index : existingText.length);
  existingFingerprints.add(fingerprint(block, match[2]));
}

let addedDefects = 0;
for (const result of results) {
  const file = path.join(cwd, result.defectFile);
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, "utf-8");
  const start = text.indexOf("### DVS-");
  if (start < 0) continue;
  const blocks = text
    .slice(start)
    .trim()
    .split(/\n(?=### DVS-)/g);
  for (const block of blocks) {
    const title = /^### DVS-\S+ — (.+)$/m.exec(block)?.[1] ?? "";
    const key = fingerprint(block, title);
    if (existingFingerprints.has(key)) continue;
    existingFingerprints.add(key);
    fs.appendFileSync(bugLog, `\n${block.trim()}\n`);
    addedDefects += 1;
  }
}

const observedDefects = results.reduce((sum, result) => sum + result.defects, 0);

/**
 * Rebuilds the BUG_DVS index table from the defect records already in the file.
 * @param {string} file - Absolute path to the defect log
 */
function rebuildBugIndex(file) {
  const text = fs.readFileSync(file, "utf-8");
  const start = text.indexOf("## Index");
  const end = text.indexOf("## Defect records");
  if (start < 0 || end < 0) return;

  const matches = [...text.matchAll(/^### (DVS-\S+) — (.+)$/gm)];
  const rows = matches.map((match, index) => {
    const next = matches[index + 1];
    const block = text.slice(match.index, next ? next.index : text.length);
    const field = (label) =>
      String(new RegExp(`^- ${label}: (.*)$`, "m").exec(block)?.[1] ?? "").replace(/\|/g, "\\|");
    const date = field("Date").slice(0, 10);
    return `| ${match[1]} | ${date} | ${field("Role")} | ${field("Area")} | ${field("Severity")} | ${match[2]} | ${field("Status") || "Open"} |`;
  });

  const table = [
    "## Index",
    "",
    "| ID | Date | Role | Area | Severity | Title | Status |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...(rows.length > 0 ? rows : ["| — | — | — | — | — | No open defects recorded yet | — |"]),
    "",
    "---",
    "",
  ].join("\n");

  fs.writeFileSync(file, text.slice(0, start) + table + text.slice(end));
}

rebuildBugIndex(bugLog);

const totalDuration = Date.now() - startedAt;
const passed = results.filter((result) => result.status === "PASS").length;
const failed = results.length - passed;
const allureExists = exists(path.join("allure-report", "index.html"));
const coverageGrand = coverage?.grand;
const pendingCount = coverageGrand
  ? coverageGrand.pending + coverageGrand.performance
  : null;
const defectGroups = results
  .filter((result) => result.defectDetails.length > 0)
  .map(
    (result) => `<div class="defect-group">
      <div class="defect-role">${escape(result.role)}: ${result.defectDetails.length} defect${
        result.defectDetails.length === 1 ? "" : "s"
      }</div>
      <ul>${result.defectDetails
        .map(
          (defect) =>
            `<li><span class="sev">${escape(defect.severity)}</span> <code>${escape(defect.id)}</code> — ${escape(defect.title)}</li>`,
        )
        .join("")}</ul>
    </div>`,
  )
  .join("\n");
const caseRowsHtml = caseResults
  .map((row) => {
    const icon =
      row.status === "passed"
        ? `<span class="tick">✓</span>`
        : row.status === "skipped"
          ? `<span class="skip">–</span>`
          : `<span class="cross">✕</span>`;
    const reason =
      row.status === "failed"
        ? `<pre>${escape(row.reason || "No error message captured.")}</pre>`
        : row.status === "skipped"
          ? escape(row.reason || "Skipped")
          : "—";
    return `<tr class="${row.status}">
      <td class="icon">${icon}</td>
      <td><span class="role">${escape(row.role)}</span></td>
      <td class="case-title">${escape(row.title)}</td>
      <td class="num">${(Number(row.duration ?? 0) / 1000).toFixed(1)}s</td>
      <td class="case-reason">${reason}</td>
    </tr>`;
  })
  .join("\n");

const coverageTable = coverage
  ? `<table>
      <thead><tr><th>Role</th><th>Documented</th><th>Covered</th><th>Automated</th><th>Live/HITL</th><th>Blocked</th><th>Pending</th><th>Coverage</th></tr></thead>
      <tbody>
        ${coverage.roles
          .map(
            (row) =>
              `<tr><td class="role">${escape(row.role)}</td><td class="num">${row.total}</td><td class="num">${row.covered}</td><td class="num">${row.automated}</td><td class="num">${row.live}</td><td class="num">${row.blocked ?? 0}</td><td class="num">${row.pending}</td><td class="num">${row.coveragePercent}%</td></tr>`,
          )
          .join("")}
        <tr><td class="role">Performance/Stress/Load</td><td class="num">${coverageGrand.performance}</td><td class="num">0</td><td class="num">0</td><td class="num">0</td><td class="num">0</td><td class="num">${coverageGrand.performance}</td><td class="num">0%</td></tr>
        <tr class="total"><td>All documented</td><td class="num">${coverageGrand.allDocumented}</td><td class="num">${coverageGrand.allCovered}</td><td class="num">${coverageGrand.automated}</td><td class="num">${coverageGrand.live}</td><td class="num">${coverageGrand.blocked ?? 0}</td><td class="num">${coverageGrand.pending + coverageGrand.performance}</td><td class="num">${coverageGrand.allCoveragePercent}%</td></tr>
      </tbody>
    </table>`
  : `<p class="muted">Coverage report not available.</p>`;

const rows = results
  .map((result) => {
    const statusClass = result.status === "PASS" ? "pass" : "fail";
    const report = result.report
      ? `<a class="button" href="../../${result.report.replace(/\\/g, "/")}">HTML report</a>`
      : `<span class="muted">no report</span>`;
    const custom = result.customReport
      ? `<a class="button alt" href="../../${result.customReport.replace(/\\/g, "/")}">Dashboard</a>`
      : "";
    const junit = result.junit
      ? `<a class="link" href="../../${result.junit.replace(/\\/g, "/")}">JUnit</a>`
      : "";
    const defects =
      result.defects > 0
        ? `<a class="defect" href="./defects/${result.role}.md">${result.defects}</a>`
        : "0";
    return `<tr>
      <td><span class="role">${escape(result.role)}</span></td>
      <td><span class="pill ${statusClass}">${result.status}</span></td>
      <td class="num">${formatDuration(result.duration)}</td>
      <td class="num">${defects}</td>
      <td class="actions">${report} ${custom} ${junit} <a class="link" href="./logs/${result.role}.log">log</a></td>
    </tr>`;
  })
  .join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DVS test cases · ${passed}/${results.length} passed</title>
<style>
  :root { color-scheme: dark; --bg:#0b1120; --panel:#111a2e; --line:#22304a; --text:#e7eefc; --muted:#8fa3c4; --pass:#22c55e; --fail:#ef4444; --accent:#38bdf8; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:"Segoe UI",system-ui,sans-serif; background:
    radial-gradient(900px 500px at 15% -10%, #17305c 0%, transparent 60%),
    radial-gradient(700px 400px at 100% 0%, #123c3a 0%, transparent 55%),
    var(--bg); color:var(--text); min-height:100vh; }
  main { max-width:1120px; margin:0 auto; padding:40px 24px 60px; }
  h1 { margin:0 0 6px; font-size:30px; letter-spacing:-.02em; }
  .sub { color:var(--muted); font-size:14px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:14px; margin:26px 0; }
  .card { background:linear-gradient(180deg,#13203a,#0f1729); border:1px solid var(--line); border-radius:14px; padding:18px 20px; }
  .card span { display:block; color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
  .card strong { display:block; margin-top:8px; font-size:28px; }
  .card strong.pass { color:var(--pass); }
  .card strong.fail { color:var(--fail); }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:16px; overflow:hidden; }
  table { width:100%; border-collapse:collapse; }
  th,td { text-align:left; padding:14px 18px; border-bottom:1px solid var(--line); font-size:14px; vertical-align:middle; }
  th { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; background:#0e1728; }
  tr:last-child td { border-bottom:none; }
  tr:hover td { background:#14203a; }
  .role { font-weight:600; text-transform:capitalize; }
  .pill { display:inline-block; padding:4px 10px; border-radius:999px; font-size:12px; font-weight:700; letter-spacing:.04em; }
  .pill.pass { background:#052e1b; color:#4ade80; border:1px solid #166534; }
  .pill.fail { background:#3a0b0b; color:#fca5a5; border:1px solid #7f1d1d; }
  .num { font-variant-numeric:tabular-nums; }
  .actions { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .button { background:var(--accent); color:#04131f; text-decoration:none; font-weight:700; padding:6px 12px; border-radius:8px; font-size:12px; }
  .button.alt { background:#1e293b; color:#c7d2fe; border:1px solid #334155; }
  .link { color:#93c5fd; font-size:12px; text-decoration:none; }
  .link:hover { text-decoration:underline; }
  .defect { color:#f87171; font-weight:700; }
  .muted { color:var(--muted); font-size:12px; }
  .footer { display:flex; gap:18px; flex-wrap:wrap; margin-top:22px; font-size:13px; }
  .footer a { color:#93c5fd; }
  .note { margin-top:16px; color:var(--muted); font-size:12px; line-height:1.6; }
  .section { margin-top:20px; }
  .panel-head { display:flex; justify-content:space-between; align-items:baseline; gap:16px; padding:16px 18px; border-bottom:1px solid var(--line); }
  .panel-head h2 { margin:0; font-size:16px; }
  .panel-head span { color:var(--muted); font-size:12px; }
  .defect-group { padding:12px 18px; border-bottom:1px solid var(--line); }
  .defect-group:last-child { border-bottom:none; }
  .defect-role { font-weight:700; color:#fca5a5; margin-bottom:6px; text-transform:capitalize; }
  .defect-group ul { margin:0; padding-left:20px; }
  .defect-group li { font-size:13px; color:#dbe7fb; padding:3px 0; }
  .sev { display:inline-block; background:#3a0b0b; color:#fca5a5; border-radius:6px; padding:1px 6px; font-size:11px; font-weight:700; margin-right:6px; }
  tr.total td { background:#0e1728; font-weight:700; }
  code { background:#1e293b; padding:1px 5px; border-radius:4px; font-size:12px; }
  .alert { margin-top:20px; background:#2a1206; border:1px solid #92400e; color:#fdba74; padding:14px 18px; border-radius:12px; font-size:14px; }
  .alert a { color:#fed7aa; font-weight:700; }
  .ok-banner { margin-top:20px; background:#052e1b; border:1px solid #166534; color:#86efac; padding:14px 18px; border-radius:12px; font-size:14px; }
  .tick, .cross, .skip { display:inline-block; width:24px; height:24px; line-height:24px; border-radius:6px; color:#fff; font-weight:800; text-align:center; }
  .tick { background:var(--pass); }
  .cross { background:var(--fail); }
  .skip { background:#64748b; }
  .icon { width:46px; text-align:center; }
  .case-title { min-width:320px; font-weight:600; }
  .case-reason pre { margin:0; white-space:pre-wrap; word-break:break-word; color:#fca5a5; background:#2a0b0b; border:1px solid #7f1d1d; border-radius:8px; padding:10px; font-size:12px; font-family:Consolas,monospace; max-height:180px; overflow:auto; }
  .case-reason { color:var(--muted); font-size:12px; }
</style>
</head>
<body>
<main>
  <h1>DVS test cases — run summary</h1>
  <div class="sub">${escape(new Date().toLocaleString())} · ${formatDuration(totalDuration)} total · command <code>npm run testcases</code></div>

  <section class="cards">
    <div class="card"><span>Roles passed</span><strong class="pass">${passed}/${results.length}</strong></div>
    <div class="card"><span>Roles failed</span><strong class="${failed ? "fail" : "pass"}">${failed}</strong></div>
    <div class="card"><span>Tests passed</span><strong class="pass">${casePassed}</strong></div>
    <div class="card"><span>Tests failed</span><strong class="${caseFailed ? "fail" : "pass"}">${caseFailed}</strong></div>
    <div class="card"><span>Tests skipped</span><strong>${caseSkipped}</strong></div>
    <div class="card"><span>Defects this run</span><strong class="${observedDefects ? "fail" : "pass"}">${observedDefects}</strong></div>
    <div class="card"><span>Cases covered</span><strong>${coverageGrand ? `${coverageGrand.allCovered}/${coverageGrand.allDocumented}` : "n/a"}</strong></div>
    <div class="card"><span>Pending cases</span><strong class="${pendingCount ? "fail" : "pass"}">${pendingCount ?? "n/a"}</strong></div>
    <div class="card"><span>Total duration</span><strong>${formatDuration(totalDuration)}</strong></div>
  </section>

  <section class="panel">
    <table>
      <thead><tr><th>Role</th><th>Status</th><th>Duration</th><th>Defects</th><th>Results</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>

  ${pendingCount
    ? `<div class="alert">Automation incomplete — ${pendingCount} of ${coverageGrand.allDocumented} documented cases are pending. <a href="./testcase-pending.csv">Open the backlog</a></div>`
    : `<div class="ok-banner">All documented cases are covered by an executable spec.</div>`}

  <section class="panel section">
    <div class="panel-head"><h2>Defects by role</h2><span>role: defects</span></div>
    ${defectGroups || `<p class="muted" style="padding:16px 18px">No new defects raised.</p>`}
  </section>

  <section class="panel section">
    <div class="panel-head"><h2>Executed test cases</h2><span>green = passed, red = reason</span></div>
    ${
      caseResults.length > 0
        ? `<table>
            <thead><tr><th>Result</th><th>Role</th><th>Test case</th><th>Duration</th><th>Failure reason</th></tr></thead>
            <tbody>${caseRowsHtml}</tbody>
          </table>`
        : `<p class="muted" style="padding:16px 18px">No per-case results were captured.</p>`
    }
  </section>

  <section class="panel section">
    <div class="panel-head"><h2>Test case coverage</h2><span>documented vs executable</span></div>
    ${coverageTable}
  </section>

  <div class="footer">
    <a href="../BUG_DVS.md">BUG_DVS.md</a>
    <a href="../testcases/DVS-TESTCASES.xlsx">Test case workbook</a>
    <a href="./testcase-coverage.md">Coverage report</a>
    <a href="./testcase-pending.csv">Pending cases</a>
    <a href="./testcases-summary.md">Markdown summary</a>
    <a href="./testcases-summary.json">JSON summary</a>
    ${allureExists ? `<a href="../../allure-report/index.html">Allure report</a>` : `<span class="muted">Allure: run npm run allure:generate</span>`}
  </div>
  <div class="note">
    Each role has its own Playwright HTML report, custom dashboard, JUnit XML and log.
    Defects are appended to docs/BUG_DVS.md. Failure media is under test-results/testcases/&lt;role&gt;/.
  </div>
</main>
</body>
</html>`;

const summaryDir = path.join(cwd, "docs", "reports");
fs.mkdirSync(summaryDir, { recursive: true });
fs.writeFileSync(path.join(summaryDir, "testcases-summary.html"), html);

const defectMd = results
  .filter((result) => result.defectDetails.length > 0)
  .flatMap((result) => [
    `### ${result.role}: ${result.defectDetails.length} defect${
      result.defectDetails.length === 1 ? "" : "s"
    }`,
    "",
    ...result.defectDetails.map(
      (defect) => `- [${defect.severity || "S?"}] ${defect.id} — ${defect.title}`,
    ),
    "",
  ]);

const summaryMd = [
  "# Test Cases Run Summary",
  "",
  `- Date: ${new Date().toISOString()}`,
  `- Command: npm run testcases${only ? ` -- --role=${only}` : ""}`,
  `- Roles run: ${selected.join(", ")}`,
  `- Roles passed: ${passed}/${results.length}`,
  `- Tests: ${casePassed} passed, ${caseFailed} failed, ${caseSkipped} skipped`,
  `- Defects this run: ${observedDefects} (new bug records: ${addedDefects})`,
  `- Total duration: ${formatDuration(totalDuration)}`,
  ...(coverageGrand
    ? [
        `- Cases covered: ${coverageGrand.allCovered}/${coverageGrand.allDocumented} (${coverageGrand.allCoveragePercent}%)`,
        `- Automated: ${coverageGrand.automated}, Live/HITL: ${coverageGrand.live}, Pending: ${
          coverageGrand.pending + coverageGrand.performance
        }`,
      ]
    : []),
  "",
  "| Role | Status | Duration | Defects | HTML report | Dashboard | Log |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...results.map(
    (result) =>
      `| ${result.role} | ${result.status} | ${formatDuration(result.duration)} | ${result.defects} | ${
        result.report ? `[open](../../${result.report.replace(/\\/g, "/")})` : "—"
      } | ${result.customReport ? `[open](../../${result.customReport.replace(/\\/g, "/")})` : "—"} | [log](./logs/${result.role}.log) |`,
  ),
  "",
  "## Defects by role",
  "",
  ...(defectMd.length > 0 ? defectMd : ["No new defects raised.", ""]),
  "## Locations",
  "",
  "- Bugs: docs/BUG_DVS.md",
  "- Coverage: docs/reports/testcase-coverage.md / .json",
  "- Pending cases: docs/reports/testcase-pending.csv",
  "- Test cases: docs/testcases/DVS-TESTCASES.xlsx",
  "- Playwright reports: reports/testcases/<role>/index.html",
  "- Custom dashboards: custom-report/testcases/<role>/index.html",
  "- JUnit: reports/testcases/<role>/results.xml",
  "- Failure media: test-results/testcases/<role>/",
  "",
].join("\n");
fs.writeFileSync(path.join(summaryDir, "testcases-summary.md"), summaryMd);
fs.writeFileSync(
  path.join(summaryDir, "testcases-summary.json"),
  JSON.stringify(
    {
      date: new Date().toISOString(),
      command: `npm run testcases${only ? ` -- --role=${only}` : ""}`,
      totalDurationMs: totalDuration,
      passed,
      failed,
      defects: observedDefects,
      newDefectRecords: addedDefects,
      tests: { passed: casePassed, failed: caseFailed, skipped: caseSkipped },
      caseResults,
      coverage: coverageGrand ?? null,
      pendingCases: "docs/reports/testcase-pending.csv",
      results,
    },
    null,
    2,
  ),
);

const consoleDefects = results
  .filter((result) => result.defectDetails.length > 0)
  .map(
    (result) =>
      `  ${result.role}: ${result.defectDetails.length} defect${
        result.defectDetails.length === 1 ? "" : "s"
      }\n` +
      result.defectDetails
        .map((defect) => `    - ${defect.severity || "S?"} ${defect.id} — ${defect.title}`)
        .join("\n"),
  )
  .join("\n");

console.log(
  `\n${"=".repeat(72)}\nTEST CASES COMPLETE\n` +
    `  Roles: ${passed}/${results.length} passed, ${failed} failed\n` +
    `  Tests: ${casePassed} passed, ${caseFailed} failed, ${caseSkipped} skipped\n` +
    `  Defects this run: ${observedDefects} (new bug records: ${addedDefects})\n` +
    (consoleDefects ? `\nDEFECTS BY ROLE\n${consoleDefects}\n\n` : "") +
    (coverageGrand
      ? `CASE COVERAGE\n  Covered: ${coverageGrand.allCovered}/${coverageGrand.allDocumented} (${coverageGrand.allCoveragePercent}%)\n  Automated: ${coverageGrand.automated}, Live/HITL: ${coverageGrand.live}, Pending: ${
          coverageGrand.pending + coverageGrand.performance
        }\n  Pending list: docs/reports/testcase-pending.csv\n\n`
      : "") +
    `  Duration: ${formatDuration(totalDuration)}\n` +
    "  Summary: docs/reports/testcases-summary.html\n" +
    "  Bugs: docs/BUG_DVS.md\n" +
    "  Per-role reports: reports/testcases/<role>/\n" +
    "  Dashboards: custom-report/testcases/<role>/\n" +
    "  Logs: docs/reports/logs/<role>.log\n" +
    `${"=".repeat(72)}\n`,
);

if (!process.env.CI && process.env.DVS_OPEN_SUMMARY !== "false" && !noOpen) {
  const target = path.join(summaryDir, "testcases-summary.html");
  const command =
    process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const commandArgs = process.platform === "win32" ? ["/c", "start", "", target] : [target];
  spawn(command, commandArgs, { detached: true, stdio: "ignore" }).unref();
}

process.exit(failed === 0 && observedDefects === 0 ? 0 : 1);
