# DVS / ADMIEZO — Playwright Test Framework

End-to-end, API and database test automation for the Digital Evaluation System (DVS / ADMIEZO). The suite provisions a real university from the platform control plane, drives every role through the full evaluation workflow, and verifies that the Admin receives the final result report.

## Contents

- [Stack](#stack)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Test projects and commands](#test-projects-and-commands)
- [Environment variables](#environment-variables)
- [End-to-end workflow](#end-to-end-workflow)
- [Test cases](#test-cases)
- [Reports and evidence](#reports-and-evidence)
- [CI](#ci)
- [Security rules](#security-rules)
- [Troubleshooting](#troubleshooting)
- [Production readiness checklist](#production-readiness-checklist)
- [Project conventions](#project-conventions)

## Stack

| Layer | Technology |
| --- | --- |
| Language | TypeScript (strict) |
| Runner | Playwright Test |
| API | Playwright `APIRequestContext`, AJV schemas |
| DB | PostgreSQL (`pg`), read-only SQLite reference snapshot |
| Data | JSON / CSV / XLSX (`xlsx`, `csv-parse`) |
| Reporting | Playwright HTML + JUnit, Allure, custom dashboard, Excel/CSV result exports |

## Architecture

```text
tests/        Executable specs (web, api, db)
pages/        Page Objects — locators and actions only
fixtures/     Custom fixtures that expose Page Objects
utils/        Auth, bootstrap, evaluation, reporting, defect helpers
api/          Route constants/builders and verified JSON schemas
testdata/     Synthetic JSON/CSV/XLSX data and binary fixtures
docs/         Test cases, defects, structure guide, result exports
prompts/      Authoritative behaviour capture per role
scripts/      Workflow runners and report helpers
```

Rules:

- Web specs import `{ test, expect }` from `fixtures/pageFixtures`, not `@playwright/test`.
- No hard-coded tenant URL, tenant name or tenant data. Read `WEB_APP_URL` / `testdata/`.
- No secrets in source, test data, logs, screenshots or traces.
- Do not fake camera, face, liveness or hardware steps. Use `Live/HITL` and wait for the app signal.
- Do not record a passing result for an unverified screen. Use `Verification needed`.

The framework's how-to guide is `playwright-mcp-context .md`. The folder-by-folder guide is `docs/PROJECT_STRUCTURE.md`.

## Prerequisites

- Node.js LTS (18+; current CI uses LTS)
- npm
- Playwright browsers
- Access to the platform control plane and an approved staging tenant
- Synthetic PDFs/images in `testdata/files/` for upload paths

## Quick start

```bash
npm ci
npx playwright install --with-deps
cp .env.example .env      # Windows: Copy-Item .env.example .env
```

Fill the platform section of `.env`:

```dotenv
PLATFORM_URL=https://platform.example.com
PLATFORM_ADMIN_EMAIL=...
PLATFORM_ADMIN_PASSWORD=...
PLATFORM_BASE_DOMAIN=...
DVS_ROLE_NEW_PASSWORD=...
DVS_ALLOW_WRITES=true
```

Provision a university and run the full workflow:

```bash
npm run test:platform
```

This creates a new tenant, completes the Admin first login, provisions every role, digitizes a script, marks and submits an evaluation, runs moderation, forwards the report, and finishes on the Admin result checklist.

Run the suites independently:

```bash
npm run typecheck
npm run test:smoke
npm run test:api
npm run test:db
npm run testcases
```

## Test projects and commands

One command runs every role test-case suite:

```bash
npm run testcases
```

Roles run headed in parallel waves and each role keeps its own report, dashboard, log and defect file.
The run ends on `docs/reports/testcases-summary.html`.

| Command | What it runs |
| --- | --- |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm test` | Every configured project |
| `npm run test:smoke` | `@smoke` coverage across roles and one full workflow |
| `npm run test:master` | `@master` suite |
| `npm run test:api` | API project + API role workflow, single worker |
| `npm run test:db` | Read-only DB project |
| `npm run test:platform` | Platform Admin provisioning → live end-to-end workflow |
| `npm run workflow` | Live web workflow only (headed, face step waits for the human) |
| `npm run workflow:all` | Platform bootstrap + workflow |
| `npm run testcases` | All implemented role suites, parallel waves, one command |
| `npm run testcases -- --role=evaluator` | One role only |
| `npm run testcases -- --max-parallel=2` | Lower or raise role parallelism (default 4) |
| `npm run testcases:report` | Reopen the latest test-case summary |
| `npm run testcases:coverage` | Recompute documented vs executable case coverage |
| `npm run testcases:coverage:strict` | Fails unless every documented case is covered |
| `npm run testcases:workbook` | Rebuild the combined test-case Excel workbook from the CSVs |
| `npm run summary` | Open the last workflow checklist and print result files |
| `npm run report` | Open the Playwright HTML report |
| `npm run allure:generate` / `allure:open` | Build/open the Allure report |

Playwright projects (`playwright.config.ts`):

| Project | Purpose |
| --- | --- |
| `setup` | Admin login, stores `playwright/.auth/admin.json` |
| `first-login` | One-time temporary-password → permanent-password flow |
| `api` | HTTP specs |
| `workflow-api` | Full API role chain |
| `db` | Read-only database validation |
| `platform` | University provisioning (headed) |
| `testcases` | Per-role test-case suites (headed) |
| `chromium` | Web UI specs with the stored Admin session |
| `workflow` | Live human-in-the-loop end-to-end workflow (headed) |

## Environment variables

Only the platform and Admin credentials are seeded. Every other role is provisioned at runtime.

| Variable | Purpose |
| --- | --- |
| `PLATFORM_URL` | Control-plane origin |
| `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` | Platform administrator |
| `PLATFORM_BASE_DOMAIN` | Shared domain used to derive the tenant URL |
| `PLATFORM_PROVISION_TIMEOUT_MS` | Provisioning budget |
| `DVS_ROLE_NEW_PASSWORD` | Permanent password applied to every provisioned role |
| `DVS_ALLOW_WRITES` | Enables state-changing workflows |
| `WEB_APP_URL` | Per-university base URL (written by the bootstrap) |
| `DVS_ADMIN_EMAIL` / `DVS_ADMIN_PASSWORD` | Tenant Admin (written by the bootstrap) |
| `DVS_CHAIRMAN_*`, `DVS_CHIEF_*`, `DVS_EVALUATOR_*`, `DVS_SCANNER_*`, `DVS_USER_MANAGER_*` | Runtime role logins |
| `DVS_API_BASE_URL`, `DVS_API_TOKEN` | API target and optional token |
| `DB_ENGINE`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | PostgreSQL connection |
| `DB_SQLITE_PATH`, `DB_READ_ONLY` | Reference snapshot and write guard |
| `PLAYWRIGHT_HEADLESS`, `PLAYWRIGHT_TIMEOUT`, `PLAYWRIGHT_EXPECT_TIMEOUT` | Runner behaviour |
| `FACE_ENROLLMENT_TIMEOUT_MS` | `0` = wait for the app signal; positive = bounded wait |
| `DVS_GEO_LATITUDE` / `DVS_GEO_LONGITUDE` | Evaluator location check |
| `DVS_OPEN_SUMMARY` | `false` disables auto-opening the end-of-flow checklist |

See `.env.example` for the full list.

## End-to-end workflow

1. Platform Admin creates a university and captures the one-time handover.
2. The new Admin replaces the temporary password; only permanent credentials are persisted.
3. Admin builds the academic chain, paper, documents, marking scheme and evaluation centre.
4. Admin provisions the User Manager and Chairman.
5. Chairman registers and nominates the Chief Examiner.
6. Chief accepts, registers and nominates the Evaluator.
7. User Manager provisions the Scanner Operator.
8. Scanner digitizes pages, submits the packet; Chief allocates it.
9. Evaluator completes face/security checks, marks, submits, sends the completion report.
10. Chief moderates; Chairman forwards; Admin receives the report.
11. The run ends on a checklist page with a link to the result and exported Excel/CSV files.

## Test cases

Per-role test cases live in `docs/testcases/` as CSV, one file per role, plus a combined Excel workbook.

| File | Role |
| --- | --- |
| `01-platform-admin.csv` | Platform Admin |
| `02-admin.csv` | University Admin |
| `03-chairman.csv` | Chairman |
| `04-chief-examiner.csv` | Chief Examiner |
| `05-evaluator.csv` | Evaluator |
| `06-scanner-operator.csv` | Scanner Operator |
| `07-user-manager.csv` | User Manager |
| `08-performance-stress-load.csv` | Cross-role performance, load, stress, spike, soak, volume and recovery |
| `DVS-TESTCASES.xlsx` | All roles plus the performance suite, one sheet per file |

Role files use 15 columns:
`ID, Role, Area, Test Layer, Execution Mode, Test Category, Test Type, Severity, Title, Preconditions, Steps, Expected Result, Test Data, Automation Status, Notes`.

Every role covers `UI`, `API` and `Database` layers; `Functional` and `Non-Functional` categories; and `Performance`, `Load`, `Stress`, `Scalability`, `Recovery`, `Resilience`, `Concurrency`, `Security`, `Accessibility`, `Usability`, `Compatibility`, `Boundary` and `Data Integrity` types. There are no manual test cases.

The performance suite uses:
`ID, Scope, Area, Test Type, Workload, Persona, Severity, Title, Preconditions, Steps, Success Criteria, Test Data, Environment, Automation Status, Notes`.

Automation status values:

- `Automated` — implemented in the Playwright suites
- `Live/HITL` — needs a human at camera/hardware
- `Automation pending` — case is defined and automatable; implementation or evidence is still pending

Rebuild the workbook after editing any CSV with `npm run testcases:workbook`.

Current automation coverage:

| Measure | Count |
| --- | ---: |
| Documented cases | 1,073 |
| Covered by an executable spec | 228 |
| Automated | 207 |
| Live/HITL | 21 |
| Environment blocked | 0 |
| Pending automation | 845 |

`npm run testcases:coverage` refreshes this table and writes the pending backlog to
`docs/reports/testcase-pending.csv`. Pending rows are documented and ready to automate;
they are not executed by `npm run testcases` until a spec references their ID.

## Reports and evidence

| Artifact | Location |
| --- | --- |
| Case results (green tick / red reason) | `docs/reports/test-results.html` |
| Per-role case results | `docs/reports/testcase-results/<role>.html` |
| Test-case run summary | `docs/reports/testcases-summary.html` |
| Test-case summary (text/JSON) | `docs/reports/testcases-summary.md`, `.json` |
| Coverage report | `docs/reports/testcase-coverage.md`, `.json` |
| Pending automation backlog | `docs/reports/testcase-pending.csv` |
| Bug log | `docs/BUG_DVS.md` |
| Per-role Playwright report | `reports/testcases/<role>/index.html` |
| Per-role JUnit XML | `reports/testcases/<role>/results.xml` |
| Per-role dashboard | `custom-report/testcases/<role>/index.html` |
| Per-role log | `docs/reports/logs/<role>.log` |
| Per-role failure media | `test-results/testcases/<role>/` |
| Workflow checklist | `docs/reports/workflow-summary.html` |
| Admin result HTML/JSON | `docs/reports/artifacts/<reportId>/` |
| Excel result | `docs/reports/DVS-EVALUATION-REPORT-<university>-<runId>.xlsx` |
| CSV result | `docs/reports/DVS-EVALUATION-REPORT-<university>-<runId>.csv` |
| Test-case workbook | `docs/testcases/DVS-TESTCASES.xlsx` |
| Aggregate Playwright HTML/JUnit | `reports/` |
| Aggregate custom dashboard | `custom-report/` |
| Allure raw/build | `allure-results/`, `allure-report/` |

Every Playwright command writes `docs/reports/test-results.html`: each executed case has a green tick when passed, a red cross and the exact failure reason when not. The page opens automatically unless `CASE_RESULTS_OPEN=false` or CI is set.

`npm run testcases` writes isolated per-role results so parallel roles cannot overwrite each other. Durable results live under `docs/reports/`; `reports/` and `custom-report/` are regenerated by the reporters.

## CI

`.github/workflows/playwright.yml` runs on push/PR to `master` and supports manual dispatch. It installs dependencies and browsers, creates `.env` from `.env.example`, runs the selected suite, and uploads reports. Secrets must be supplied as repository/environment variables; never commit `.env`.

## Security rules

- Never commit `.env`, `playwright/.auth/*`, screenshots or traces containing account data.
- Temporary passwords are single-use: never log or persist them.
- Sensitive actions require the actor's own step-up; tests must not bypass it.
- Tenant isolation must be asserted, not assumed: no cross-tenant ids, headers or URLs.
- Uploads use synthetic PDF/JPEG fixtures only.
- Disable or gate writes with `DVS_ALLOW_WRITES`.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Set WEB_APP_URL` skip | Run `npm run test:platform` to provision a university |
| Live workflow waits at camera | Human must complete face enrollment; the run continues automatically when the app verifies |
| "Click here to view result" → file not found | Result was saved before artifacts moved to `docs/reports/`; rerun the workflow |
| `.xlsx` shows "binary or unsupported" | Open the CSV, or install the Excel Viewer VS Code extension |
| Allure report missing | Run `npm run allure:generate` then `npm run allure:open` |
| Auth setup skipped | Admin first login pending; run `npm run test:first-login` once |
| Role credentials missing | The platform bootstrap did not finish role provisioning; rerun `npm run test:platform` |
| Test-case run finished but no summary opened | `npm run testcases:report` |
| Parallel run is flaky on a small machine | `npm run testcases -- --max-parallel=2` |
| A bug was raised during the run | Open `docs/BUG_DVS.md`; the run continues and the summary marks the role FAIL |

## Production readiness checklist

- [ ] `npm run typecheck` passes.
- [ ] `npm run test:smoke` passes on a fresh tenant.
- [ ] Full `npm run test:platform` reaches the Admin result checklist.
- [ ] The result HTML, Excel and CSV are present under `docs/reports/`.
- [ ] `docs/testcases/DVS-TESTCASES.xlsx` is rebuilt and reviewed.
- [ ] Performance, load, stress, spike, soak and recovery gates in `08-performance-stress-load.csv` have agreed budgets.
- [ ] No UI, API or database layer is missing coverage for any role.
- [ ] No manual-only case is required for a release decision.
- [ ] No defect in `docs/BUG_DVS.md` is open at S1/S2.
- [ ] Sensitive actions, RBAC and tenant isolation are covered by automated checks.
- [ ] Camera/face/geolocation checks are marked `Live/HITL`, not faked.
- [ ] CI secrets are configured; `.env` is not committed.
- [ ] Report retention and artifact upload are working.

## Project conventions

- Page Objects own locators; specs own assertions.
- Fixtures expose Page Objects; add every new class to `fixtures/pageFixtures.ts`.
- One workflow per spec, sections in `test.step('N) …')`.
- Prefer `getByRole` → `getByLabel` → `getByText` → `getByPlaceholder` → `getByTestId` → CSS.
- Assert business outcomes and persisted state, not just clicks.
- Record observed defects in `docs/BUG_DVS.md` and continue the run.
