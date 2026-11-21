import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

type CaseStatus = "passed" | "failed" | "skipped";

type CaseResult = {
  title: string;
  file: string;
  status: CaseStatus;
  duration: number;
  reason: string;
  retry: number;
  tags: string[];
};

const plain = (value: unknown) =>
  String(value ?? "").replace(/\u001b\[[0-9;]*m/g, "");
const escape = (value: unknown) =>
  plain(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Writes an end-of-run page that lists every executed test with a green tick
 * when it passed and the failure reason when it did not.
 *
 * Output defaults to `docs/reports/test-results.html`; the parallel role runner
 * overrides it per role through `CASE_RESULTS_FILE`.
 */
export default class CaseResultReporter implements Reporter {
  private results = new Map<string, CaseResult>();
  private startedAt = new Date();
  private outputFile = path.resolve(process.cwd(), "docs", "reports", "test-results.html");
  private sidecar = path.resolve(process.cwd(), "docs", "reports", "test-results.cases.jsonl");
  private config!: FullConfig;

  onBegin(config: FullConfig, _suite: Suite): void {
    this.config = config;
    const configured = process.env.CASE_RESULTS_FILE?.trim();
    this.outputFile = configured
      ? path.resolve(process.cwd(), configured)
      : path.resolve(process.cwd(), "docs", "reports", "test-results.html");
    this.sidecar = process.env.CASE_RESULTS_JSONL?.trim()
      ? path.resolve(process.cwd(), process.env.CASE_RESULTS_JSONL.trim())
      : this.outputFile.replace(/\.html?$/i, ".cases.jsonl");
    // A new run starts with a clean case ledger.
    fs.rmSync(this.sidecar, { force: true });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const status: CaseStatus =
      result.status === "passed"
        ? "passed"
        : result.status === "skipped"
          ? "skipped"
          : "failed";

    const previous = this.results.get(test.id);
    if (previous && previous.retry > result.retry) return;

    const error = result.error?.message ?? "";
    this.results.set(test.id, {
      title: test.title,
      file: path.relative(process.cwd(), test.location.file),
      status,
      duration: result.duration,
      reason: error,
      retry: result.retry,
      tags: test.tags ?? [],
    });
  }

  async onEnd(result: FullResult): Promise<void> {
    const caseRows: CaseResult[] = [];
    if (fs.existsSync(this.sidecar)) {
      for (const line of fs.readFileSync(this.sidecar, "utf-8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as {
            case?: string;
            title?: string;
            status?: CaseStatus;
            reason?: string;
          };
          caseRows.push({
            title: parsed.title || parsed.case || "(unnamed case)",
            file: "",
            status: parsed.status === "passed" ? "passed" : "failed",
            duration: 0,
            reason: parsed.reason ?? "",
            retry: 0,
            tags: [],
          });
        } catch {
          // Ignore a partial line from a crashed worker.
        }
      }
    }

    const rows = caseRows.length > 0 ? caseRows : [...this.results.values()];
    const passed = rows.filter((row) => row.status === "passed").length;
    const failed = rows.filter((row) => row.status === "failed").length;
    const skipped = rows.filter((row) => row.status === "skipped").length;
    const duration = Date.now() - this.startedAt.getTime();

    const html = this.render({ rows, passed, failed, skipped, duration, status: result.status });
    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    fs.writeFileSync(this.outputFile, html);
    fs.writeFileSync(
      this.outputFile.replace(/\.html?$/i, ".json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          status: result.status,
          durationMs: duration,
          totals: { total: rows.length, passed, failed, skipped },
          results: rows,
        },
        null,
        2,
      ),
    );

    console.log(
      `\nCASE RESULTS: ${passed} passed, ${failed} failed, ${skipped} skipped\n  ${this.outputFile}\n`,
    );

    if (process.env.CI || process.env.CASE_RESULTS_OPEN === "false") return;
    const command =
      process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", this.outputFile] : [this.outputFile];
    spawn(command, args, { detached: true, stdio: "ignore" }).unref();
  }

  private render(data: {
    rows: CaseResult[];
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
    status: string;
  }): string {
    const body = data.rows
      .map((row) => {
        const icon =
          row.status === "passed"
            ? `<span class="tick">✓</span>`
            : row.status === "skipped"
              ? `<span class="skip">–</span>`
              : `<span class="cross">✕</span>`;
        return `<tr class="${row.status}">
          <td class="icon">${icon}</td>
          <td><span class="status ${row.status}">${row.status}</span></td>
          <td class="title">${escape(row.title)}<div class="file">${escape(row.file)}</div></td>
          <td class="duration">${(row.duration / 1000).toFixed(1)}s</td>
          <td class="reason">${
            row.status === "failed"
              ? `<pre>${escape(row.reason || "No error message captured.")}</pre>`
              : row.status === "skipped"
                ? escape(row.reason || "Skipped")
                : "—"
          }</td>
        </tr>`;
      })
      .join("\n");

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test case results · ${data.passed} passed / ${data.failed} failed</title>
<style>
  :root { color-scheme: light; --green:#16a34a; --red:#dc2626; --amber:#b45309; --line:#dde3ea; --muted:#5d6b7a; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:"Segoe UI",system-ui,sans-serif; background:#f4f6f8; color:#1c2430; }
  main { max-width:1240px; margin:0 auto; padding:36px 24px 56px; }
  h1 { margin:0 0 6px; font-size:26px; }
  .sub { color:var(--muted); font-size:13px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin:24px 0; }
  .card { background:#fff; border:1px solid var(--line); border-radius:12px; padding:16px 18px; }
  .card span { display:block; color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.06em; }
  .card strong { display:block; margin-top:6px; font-size:26px; }
  .card strong.green { color:var(--green); }
  .card strong.red { color:var(--red); }
  .panel { background:#fff; border:1px solid var(--line); border-radius:14px; overflow:hidden; }
  table { width:100%; border-collapse:collapse; }
  th,td { text-align:left; padding:13px 16px; border-bottom:1px solid #eef1f5; font-size:13px; vertical-align:top; }
  th { background:#f8fafc; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.06em; }
  tr:last-child td { border-bottom:none; }
  .icon { width:52px; text-align:center; }
  .tick { display:inline-block; width:26px; height:26px; line-height:26px; border-radius:7px; background:var(--green); color:#fff; font-weight:800; text-align:center; }
  .cross { display:inline-block; width:26px; height:26px; line-height:26px; border-radius:7px; background:var(--red); color:#fff; font-weight:800; text-align:center; }
  .skip { display:inline-block; width:26px; height:26px; line-height:26px; border-radius:7px; background:#94a3b8; color:#fff; font-weight:800; text-align:center; }
  .status { font-size:11px; font-weight:700; text-transform:uppercase; }
  .status.passed { color:var(--green); }
  .status.failed { color:var(--red); }
  .status.skipped { color:var(--amber); }
  .title { min-width:320px; font-weight:600; }
  .file { color:var(--muted); font-size:11px; margin-top:3px; font-family:Consolas,monospace; }
  .duration { white-space:nowrap; color:var(--muted); }
  .reason pre { margin:0; white-space:pre-wrap; word-break:break-word; color:#991b1b; background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:10px; font-size:12px; font-family:Consolas,monospace; max-height:220px; overflow:auto; }
  .banner { margin:18px 0 0; padding:13px 16px; border-radius:10px; font-size:14px; }
  .banner.ok { background:#f0fdf4; border:1px solid #bbf7d0; color:#166534; }
  .banner.bad { background:#fef2f2; border:1px solid #fecaca; color:#991b1b; }
  footer { margin-top:18px; font-size:12px; color:var(--muted); }
</style>
</head>
<body>
<main>
  <h1>Test case results</h1>
  <div class="sub">${escape(new Date().toLocaleString())} · suite status ${escape(data.status)} · ${(data.duration / 1000).toFixed(1)}s</div>

  <section class="cards">
    <div class="card"><span>Passed</span><strong class="green">${data.passed}</strong></div>
    <div class="card"><span>Failed</span><strong class="${data.failed ? "red" : "green"}">${data.failed}</strong></div>
    <div class="card"><span>Skipped</span><strong>${data.skipped}</strong></div>
    <div class="card"><span>Total</span><strong>${data.rows.length}</strong></div>
  </section>

  <div class="banner ${data.failed ? "bad" : "ok"}">
    ${data.failed ? `${data.failed} test case(s) failed — reasons are listed below.` : "All executed test cases passed."}
  </div>

  <section class="panel" style="margin-top:16px">
    <table>
      <thead><tr><th>Result</th><th>Status</th><th>Test case</th><th>Duration</th><th>Failure reason</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </section>

  <footer>Generated by CaseResultReporter · ${escape(this.config?.projects?.length ?? 0)} project(s)</footer>
</main>
</body>
</html>`;
  }
}
