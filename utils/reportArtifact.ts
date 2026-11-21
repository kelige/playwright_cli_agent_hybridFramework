import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import * as XLSX from "xlsx";
import type { Json } from "./apiClient";

/**
 * Root folder for generated report artifacts. A parallel university-matrix run
 * points this at the tenant's own folder so its reports never collide.
 * @returns Absolute report root
 */
function reportRoot(): string {
  const configured = process.env.DVS_REPORT_ROOT?.trim();
  return configured ? path.resolve(configured) : path.resolve(process.cwd(), "docs", "reports");
}

/** Escapes text for safe insertion into the report HTML. */
function escape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Renders the Admin-received evaluation report as a self-contained HTML page.
 * @param report - Report row from the evaluation workflow catalog
 * @param detail - Report detail (snapshot rows and forwarding data)
 * @param tenantUrl - Tenant the report belongs to
 * @returns The HTML document
 */
export function renderReportHtml(report: Json, detail: Json, tenantUrl: string): string {
  const snapshot = (detail.snapshot ?? {}) as Json;
  const rows = (snapshot.rows ?? []) as Json[];
  const forwarded = snapshot.chairman_forwarding as Json | undefined;

  const rowHtml = rows
    .map(
      (row) => `<tr>
        <td>${escape(row.script)}</td>
        <td>${escape(row.subject)}<br><small>${escape(row.subject_code)}</small></td>
        <td>${escape(row.evaluator)}<br><small>${escape(row.evaluator_code)}</small></td>
        <td class="num">${escape(row.total_marks)}</td>
        <td><span class="pill">${escape(row.status)}</span></td>
        <td><span class="pill ok">${escape(row.moderation)}</span></td>
        <td>${escape(row.submitted_at)}</td>
      </tr>`,
    )
    .join("\n");

  const totalMarks = rows.reduce((sum, row) => sum + Number(row.total_marks ?? 0), 0);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Evaluation report ${escape(report.id)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; background: #f4f6f8; color: #1c2430; }
  main { max-width: 1040px; margin: 0 auto; padding: 32px 24px 48px; }
  header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; flex-wrap: wrap; }
  h1 { margin: 0 0 6px; font-size: 24px; }
  .muted { color: #5d6b7a; font-size: 13px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin: 24px 0; }
  .card { background: #fff; border: 1px solid #dde3ea; border-radius: 10px; padding: 14px 16px; }
  .card span { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #6b7a89; }
  .card strong { display: block; margin-top: 6px; font-size: 20px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #dde3ea; border-radius: 10px; overflow: hidden; }
  th, td { text-align: left; padding: 12px 14px; border-bottom: 1px solid #eef1f5; font-size: 13px; vertical-align: top; }
  th { background: #f8fafc; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #6b7a89; }
  td.num { font-weight: 600; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #eef1f5; font-size: 12px; }
  .pill.ok { background: #e5f6ec; color: #14683a; }
  .timeline { margin: 28px 0 0; padding: 0; list-style: none; }
  .timeline li { position: relative; padding: 0 0 18px 26px; font-size: 13px; }
  .timeline li::before { content: ""; position: absolute; left: 4px; top: 4px; width: 8px; height: 8px; border-radius: 50%; background: #1f7a4d; }
  .timeline li::after { content: ""; position: absolute; left: 7px; top: 14px; bottom: 0; width: 2px; background: #d7e2da; }
  .timeline li:last-child::after { display: none; }
  code { background: #eef1f5; padding: 2px 6px; border-radius: 4px; font-size: 12px; word-break: break-all; }
  footer { margin-top: 28px; font-size: 12px; color: #5d6b7a; }
</style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Evaluation report received by Admin</h1>
      <div class="muted">${escape(tenantUrl)} · Report <code>${escape(report.id)}</code></div>
    </div>
    <div class="muted">Generated ${escape(new Date().toISOString())}</div>
  </header>

  <section class="cards">
    <div class="card"><span>Paper</span><strong>${escape(report.paper)}</strong></div>
    <div class="card"><span>Total marks</span><strong>${escape(totalMarks.toFixed(2))}</strong></div>
    <div class="card"><span>Report status</span><strong>${escape(report.status)}</strong></div>
    <div class="card"><span>Scripts</span><strong>${escape(rows.length)}</strong></div>
  </section>

  <table>
    <thead>
      <tr><th>Script</th><th>Subject</th><th>Evaluator</th><th>Marks</th><th>Status</th><th>Moderation</th><th>Submitted</th></tr>
    </thead>
    <tbody>
      ${rowHtml}
    </tbody>
  </table>

  <ol class="timeline">
    <li>Evaluator submitted the script${rows[0]?.submitted_at ? ` · ${escape(rows[0].submitted_at)}` : ""}</li>
    <li>Chief completed moderation${rows[0]?.moderation ? ` · ${escape(rows[0].moderation)}` : ""}</li>
    <li>Chairman forwarded the report${forwarded?.sent_at ? ` · ${escape(forwarded.sent_at)}` : ""}</li>
    <li>Admin received the report${report.forwarded_at ? ` · ${escape(report.forwarded_at)}` : ""}</li>
  </ol>

  <footer>
    Valuation checksum: ${rows[0]?.valuation_checksum ? `<code>${escape(rows[0].valuation_checksum)}</code>` : "—"}
  </footer>
</main>
</body>
</html>`;
}

/**
 * Stores the Admin report as JSON and HTML so the run leaves a durable record.
 * @param reportId - Report id
 * @param report - Report row from the catalog
 * @param detail - Report detail endpoint body
 * @param tenantUrl - Tenant the report belongs to
 * @returns Paths of the saved JSON and HTML files
 */
export function saveReportArtifact(
  reportId: string,
  report: Json,
  detail: Json,
  tenantUrl: string,
): { jsonPath: string; htmlPath: string } {
  const dir = path.join(reportRoot(), "artifacts", reportId);
  fs.mkdirSync(dir, { recursive: true });

  const jsonPath = path.join(dir, "report.json");
  const htmlPath = path.join(dir, "report.html");
  fs.writeFileSync(jsonPath, JSON.stringify({ tenantUrl, report, detail }, null, 2));
  fs.writeFileSync(htmlPath, renderReportHtml(report, detail, tenantUrl));
  return { jsonPath, htmlPath };
}

/** Spreadsheet columns written for every script in the Admin report. */
const REPORT_COLUMNS: { header: string; value: (row: Json) => unknown }[] = [
  { header: "Script", value: (row) => row.script },
  { header: "Subject", value: (row) => row.subject },
  { header: "Subject code", value: (row) => row.subject_code },
  { header: "Evaluator", value: (row) => row.evaluator },
  { header: "Evaluator code", value: (row) => row.evaluator_code },
  { header: "Total marks", value: (row) => row.total_marks },
  { header: "Status", value: (row) => row.status },
  { header: "Moderation", value: (row) => row.moderation },
  { header: "Submitted at", value: (row) => row.submitted_at },
  { header: "Valuation checksum", value: (row) => row.valuation_checksum },
];

/**
 * Stores the Admin report as an Excel workbook under `docs/reports/`, with a
 * summary sheet and one row per script, so the result is readable outside the run.
 * @param reportId - Report id
 * @param report - Report row from the evaluation workflow catalog
 * @param detail - Report detail endpoint body
 * @param tenantUrl - Tenant the report belongs to
 * @param universityName - University name used in the file name and summary
 * @param runId - Run identifier used in the file name
 * @returns Paths of the workbook and CSV, and the number of script rows
 */
export function saveReportDocs(
  reportId: string,
  report: Json,
  detail: Json,
  tenantUrl: string,
  universityName: string,
  runId: string,
): { xlsxPath: string; csvPath: string; rowCount: number } {
  const rows = (((detail.snapshot ?? {}) as Json).rows ?? []) as Json[];
  const totalMarks = rows.reduce((sum, row) => sum + Number(row.total_marks ?? 0), 0);

  const summarySheet = XLSX.utils.aoa_to_sheet([
    ["Field", "Value"],
    ["Report ID", reportId],
    ["Report status", report.status],
    ["Paper", report.paper],
    ["University", universityName],
    ["Tenant URL", tenantUrl],
    ["Scripts", rows.length],
    ["Total marks", totalMarks],
    ["Generated", new Date().toISOString()],
  ]);

  const scriptRows = rows.map((row) =>
    Object.fromEntries(REPORT_COLUMNS.map((column) => [column.header, column.value(row) ?? ""])),
  );
  const scriptsSheet = XLSX.utils.json_to_sheet(scriptRows, {
    header: REPORT_COLUMNS.map((column) => column.header),
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(workbook, scriptsSheet, "Scripts");

  const dir = reportRoot();
  fs.mkdirSync(dir, { recursive: true });
  const safeName = (value: string) =>
    value
      .trim()
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "");
  const fileBase = `DVS-EVALUATION-REPORT-${safeName(universityName) || "university"}-${safeName(runId)}`;
  const xlsxPath = path.join(dir, `${fileBase}.xlsx`);
  const csvPath = path.join(dir, `${fileBase}.csv`);

  XLSX.writeFile(workbook, xlsxPath);
  fs.writeFileSync(csvPath, `\uFEFF${XLSX.utils.sheet_to_csv(scriptsSheet)}`);
  return { xlsxPath, csvPath, rowCount: rows.length };
}

/** One completed checklist row shown at the end of the workflow. */
export type WorkflowSummaryEntry = {
  title: string;
  /** Who performed the milestone, e.g. "Platform Admin" or "University Admin". */
  actor?: string;
  details?: { label: string; value: string }[];
};

/** Everything the terminal workflow checklist page shows. */
export type WorkflowSummary = {
  runId: string;
  tenantUrl: string;
  entries: WorkflowSummaryEntry[];
  reportId: string;
  reportHref: string;
  spreadsheetPath?: string;
  csvPath?: string;
};

/**
 * Renders the terminal workflow checklist: one green tick per completed stage,
 * the university and every role credential, and a final link to the Admin report.
 * @param summary - Completed stages and the report link
 * @returns The HTML document
 */
export function renderWorkflowSummary(summary: WorkflowSummary): string {
  const total = summary.entries.length;
  const rows = summary.entries
    .map((entry, index) => {
      const details = (entry.details ?? [])
        .map(
          (detail) => `<div class="detail"><span>${escape(detail.label)}</span><strong>${escape(detail.value)}</strong></div>`,
        )
        .join("\n");
      const actor = entry.actor ? `<span class="actor">${escape(entry.actor)}</span>` : "";
      return `<li class="done">
        <span class="tick" aria-hidden="true">✓</span>
        <div class="row">
          <div class="title"><span class="step">${index + 1}</span>${escape(entry.title)}${actor}</div>
          ${details}
        </div>
      </li>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DVS workflow complete · ${escape(summary.runId)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; background: #f4f6f8; color: #1c2430; }
  main { max-width: 860px; margin: 0 auto; padding: 36px 24px 56px; }
  h1 { margin: 0 0 6px; font-size: 26px; }
  .muted { color: #5d6b7a; font-size: 13px; }
  .banner { margin-top: 20px; display: flex; align-items: center; gap: 16px; background: #fff; border: 1px solid #dde3ea; border-radius: 14px; padding: 18px 20px; }
  .banner .count { font-size: 30px; font-weight: 700; color: #16a34a; line-height: 1; }
  .banner .label { font-weight: 600; font-size: 14px; }
  .banner .bar { flex: 1; height: 8px; background: #e7edf3; border-radius: 999px; overflow: hidden; }
  .banner .fill { height: 100%; width: 100%; background: #16a34a; }
  .panel { margin-top: 20px; background: #fff; border: 1px solid #dde3ea; border-radius: 14px; padding: 10px 20px; }
  ul.checklist { list-style: none; margin: 0; padding: 0; }
  ul.checklist li { display: flex; gap: 14px; padding: 14px 0; border-bottom: 1px solid #eef1f5; }
  ul.checklist li:last-child { border-bottom: none; }
  .tick { flex: 0 0 auto; width: 24px; height: 24px; border-radius: 6px; background: #16a34a; color: #fff; font-weight: 700; font-size: 15px; line-height: 24px; text-align: center; }
  .title { font-weight: 600; font-size: 15px; display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .step { display: inline-block; min-width: 22px; height: 22px; border-radius: 999px; background: #eef2f7; color: #47576a; font-size: 12px; font-weight: 700; line-height: 22px; text-align: center; }
  .actor { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: #2f6f4f; background: #eaf7f0; border: 1px solid #c9ecd9; border-radius: 999px; padding: 2px 9px; }
  .detail { display: flex; gap: 8px; font-size: 13px; margin-top: 5px; }
  .detail span { color: #5d6b7a; min-width: 140px; }
  .detail strong { font-family: "Consolas", monospace; font-weight: 600; word-break: break-all; }
  .result { margin-top: 22px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 14px; padding: 20px; text-align: center; }
  .result p { margin: 0 0 10px; font-weight: 600; }
  .result a { display: inline-block; background: #16a34a; color: #fff; text-decoration: none; font-weight: 600; padding: 11px 22px; border-radius: 9px; }
  .result a:hover { background: #15803d; }
  footer { margin-top: 22px; font-size: 12px; color: #5d6b7a; }
</style>
</head>
<body>
<main>
  <h1>DVS workflow complete</h1>
  <div class="muted">${escape(summary.tenantUrl)} · Run <code>${escape(summary.runId)}</code></div>

  <section class="banner">
    <div class="count">${total}/${total}</div>
    <div>
      <div class="label">Milestones completed</div>
      <div class="muted">Provisioning through to the Admin receiving the report</div>
    </div>
    <div class="bar"><div class="fill"></div></div>
  </section>

  <section class="panel">
    <ul class="checklist">
      ${rows}
    </ul>
  </section>

  <section class="result">
    <p>Admin received the result report.</p>
    <a href="${escape(summary.reportHref)}">Click here to view result</a>
    ${summary.spreadsheetPath ? `<p class="muted" style="margin:14px 0 0">Excel: <code>${escape(summary.spreadsheetPath)}</code></p>` : ""}
    ${summary.csvPath ? `<p class="muted" style="margin:6px 0 0">CSV: <code>${escape(summary.csvPath)}</code></p>` : ""}
  </section>

  <footer>Report <code>${escape(summary.reportId)}</code> · Generated ${escape(new Date().toISOString())}</footer>
</main>
</body>
</html>`;
}

/**
 * Stores the terminal checklist beside the report and as a stable latest copy,
 * so the workflow ends on a page that links straight to the Admin result.
 * @param reportId - Report id the checklist belongs to
 * @param summary - Completed stages and credentials
 * @returns Paths of the per-run and latest checklist pages
 */
export function saveWorkflowSummary(
  reportId: string,
  summary: Omit<WorkflowSummary, "reportId" | "reportHref">,
): { summaryPath: string; latestPath: string } {
  const dir = path.join(reportRoot(), "artifacts", reportId);
  fs.mkdirSync(dir, { recursive: true });

  const summaryPath = path.join(dir, "summary.html");
  fs.writeFileSync(
    summaryPath,
    renderWorkflowSummary({
      ...summary,
      reportId,
      reportHref: "report.html",
    }),
  );

  const latestDir = reportRoot();
  const latestPath = path.join(latestDir, "workflow-summary.html");
  fs.writeFileSync(
    latestPath,
    renderWorkflowSummary({
      ...summary,
      reportId,
      reportHref: `artifacts/${reportId}/report.html`,
    }),
  );

  return { summaryPath, latestPath };
}

/**
 * Opens the terminal checklist in the default browser unless the run is in CI
 * or `DVS_OPEN_SUMMARY=false`.
 * @param filePath - Checklist page to open
 */
export function openWorkflowSummary(filePath: string): void {
  if (process.env.CI || process.env.DVS_OPEN_SUMMARY === "false") return;
  const command =
    process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args =
    process.platform === "win32" ? ["/c", "start", "", filePath] : [filePath];
  spawn(command, args, { detached: true, stdio: "ignore" }).unref();
}
