# Project Structure Guide — Playwright Framework (DVS / ADMIEZO)

This document explains every folder in this repository: why it exists, what it stores, and a concrete example of its contents.

---

## 1. What this project is

A Playwright + TypeScript test automation framework for the **Digital Evaluation System (DVS / ADMIEZO)**.

It covers three layers:

- **Web UI** — Page Objects, custom fixtures, browser specs.
- **API** — route constants, JSON schemas, request specs.
- **DB** — read-only database validation.

The authoritative "how to build tests" guide is `playwright-mcp-context .md`.
The "what to test" drivers are in `prompts/`.

---

## 2. Top-level map

```text
Playwright_Framework_opercart/
├── .claude/                 AI tool config (Claude skills)
├── .clinerules/             AI tool config (Cline rules)
├── .commandcode/            AI tool config (Command Code taste/preferences)
├── .cursor/                 AI tool config (Cursor rules)
├── .github/                 CI workflow + Copilot instructions
├── .opencode/               AI tool config (OpenCode agent rules)
├── .playwright/             Playwright runtime dir (currently empty)
├── .playwright-cli/         Playwright CLI capture logs/snapshots
├── .windsurf/               AI tool config (Windsurf rules)
├── allure-results/          Raw Allure result files (generated)
├── api/                     API routes + JSON schemas
├── custom-report/           Custom HTML reports (generated)
├── docs/                    Project documentation (this guide)
├── fixtures/                Playwright custom fixtures
├── node_modules/            Installed npm dependencies (generated)
├── pages/                   Page Object Model classes
├── playwright/              Playwright auth state (`playwright/.auth/`)
├── prompts/                 Test prompt files + SQLite reference snapshot
├── reports/                 Playwright HTML + JUnit reports (generated)
├── test-results/            Run artifacts: screenshots/videos/traces (generated)
├── testdata/                Static JSON/CSV/XLSX data + binary fixtures
├── tests/                   Test specs (web / api / db) + auth setup
├── utils/                   Reusable helpers, reporters, data generators
├── .env                     Local secrets/environment (gitignored)
├── .env.example             Documented environment template
├── .gitignore               Ignored files and generated folders
├── AGENTS.md                Agent behavior instructions
├── env_setup.bat            Windows dependency/bootstrap script
├── package.json             Scripts + dependencies
├── package-lock.json        Locked dependency tree
├── playwright-mcp-context .md   Framework rules (single source of truth)
├── playwright.config.ts     Playwright projects, reporters, timeouts
└── tsconfig.json            Strict TypeScript config
```

Legend:

- **Source of truth** — edit by hand.
- **Generated** — produced by a test run; safe to regenerate.
- **Local secret** — never commit.

---

## 3. Source folders

### 3.1 `tests/` — test specs

Why: holds every executable spec, grouped by automation layer.

What it stores:

```text
tests/
├── auth.setup.ts                 # Admin login once, saves storageState
├── web/
│   ├── authentication/
│   │   ├── first-login-password-set.spec.ts
│   │   ├── invalid-login.spec.ts
│   │   ├── role-login-matrix.spec.ts
│   │   └── data-driven-login.spec.ts
│   ├── admin/
│   │   └── programme.spec.ts
│   ├── platform/
│   │   └── university-bootstrap.spec.ts
│   └── exam-configuration/
│       ├── exam-configuration-required-fields.spec.ts
│       └── exam-configuration-required-fields.cases.md
├── api/                          # currently only .gitkeep
└── db/                           # currently only .gitkeep
```

Rules:

- Web specs import `{ test, expect }` from `fixtures/pageFixtures`, never directly from `@playwright/test`.
- One spec per workflow area; file names are kebab-case.
- Each test title carries tags, e.g. `@master @web @admin`.
- Each flow section is wrapped in `test.step('N) …')`.

Example (`tests/web/authentication/role-login-matrix.spec.ts`):

```ts
for (const role of DVS_ROLES) {
  test(`${role.label} sees only its own workspace`, async ({
    loginPage,
    setPasswordPage,
    shellPage,
  }) => {
    const state = await signInAndResolveState(
      loginPage, setPasswordPage, shellPage, email, password,
    );
    await expect(shellPage.moduleButton("Exam configuration").first()).toBeVisible();
  });
}
```

`auth.setup.ts` special case:

- Runs once as the `setup` project.
- Logs in as Admin and writes `playwright/.auth/admin.json`.
- The `chromium` project reuses that file via `storageState`.

### 3.2 `pages/` — Page Object Model

Why: keeps locators and page actions out of specs. One class per screen.

What it stores:

```text
pages/
├── LoginPage.ts
├── SetPasswordPage.ts
├── AuthenticatedShellPage.ts
├── PlatformAdminPage.ts
└── ExamConfigurationPage.ts
```

`PlatformAdminPage` drives the platform control plane (`PLATFORM_URL`): sign-in,
**Platform → Universities**, waiting for the create-tenant response, and the
one-time **Administrator handover**. It never logs or persists the temporary password.

Example (`pages/LoginPage.ts`):

```ts
export class LoginPage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;

  constructor(page: Page) {
    this.emailInput = page.locator('input[type="email"]');
    this.passwordInput = page.locator('input[type="password"]');
    this.signInButton = page.getByRole("button", { name: "Sign in" });
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.signInButton.click();
  }
}
```

Conventions:

- Locator priority: `getByRole` → `getByLabel` → `getByText` → `getByPlaceholder` → `getByTestId` → CSS.
- No `nth-child`, no XPath, no generated class chains.
- No assertions inside Page Objects, except `isXxxExists()` checks.
- Every new class must be wired into `fixtures/pageFixtures.ts`.

### 3.3 `fixtures/` — custom Playwright fixtures

Why: exposes Page Objects to tests and centralizes auth/session setup.

What it stores:

- `pageFixtures.ts` — the single fixture file.
- `PageFixtures` type — maps fixture names to Page Object classes.
- `base.extend(...)` — creates each Page Object with the current `page`.
- `ensureAdminSession(page, loginPage)` — guarantees an Admin session.

Example:

```ts
export type PageFixtures = {
  loginPage: LoginPage;
  setPasswordPage: SetPasswordPage;
  shellPage: AuthenticatedShellPage;
  examConfigurationPage: ExamConfigurationPage;
};

export const test = base.extend<PageFixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
});

export { expect };
export async function ensureAdminSession(page, loginPage) { /* ... */ }
```

Why it matters: a spec can request `loginPage` or `shellPage` directly instead of constructing classes.

### 3.4 `utils/` — shared utilities

Why: reusable logic that is not tied to one page or one spec.

What it stores:

| File | Purpose | Example |
|---|---|---|
| `helper.ts` | Fixed/synthetic data + env-key lookup | `Helper.getDvsTestRunId()` → `DVS-RUN-1762…-AB12CD` |
| `dataGenerator.ts` | Faker-based random data | `RandomDataUtil.getProgrammeCode()` → `DVS-AUTO-XYZ1234` |
| `DataReader.ts` | JSON / CSV / Excel readers | `DataProvider.readJson('testdata/dvs_logindata.json')` |
| `dvsAuth.ts` | Shared sign-in state resolver | returns `"shell"`, `"password-set"`, or `"rejected"` |
| `dvsRoles.ts` | Role → sidebar module inventory | `admin` → `["Exam configuration", "Marking schemes", "Access governance"]`; `PLATFORM_ROLES` holds the control-plane role |
| `platformBootstrap.ts` | Normalizes the create-tenant response and completes the university Admin first login | derives the tenant URL, persists only permanent credentials |
| `CustomReporter.ts` | Custom HTML report generator | writes `custom-report/report_<timestamp>.html` |

Example (`utils/dvsRoles.ts`):

```ts
export const DVS_ROLES = [
  { role: "evaluator", label: "Evaluator", modules: ["Evaluation desk"] },
  { role: "scanner_operator", label: "Scanner Operator", modules: ["Digitization"] },
] as const;
```

Rule: check for an existing utility before adding another. Do not duplicate methods.

### 3.5 `testdata/` — static and binary test data

Why: separates test data from test logic, and supports data-driven tests.

What it stores:

```text
testdata/
├── dvs_academic_config.json      # programme → regulation → year → session → course → subject
├── dvs_paper_config.json         # paper, sections, marks, document paths
├── dvs_marks.json                # valid/invalid marks and expected totals
├── dvs_user_provisioning.json    # roles, modules, evaluator profiles
├── dvs_logindata.json            # data-driven login rows
├── dvs_logindata.csv             # same rows, CSV form
├── dvs_logindata.xlsx            # same rows, Excel form
└── files/
    └── README.md                 # required PDF/JPEG fixtures (not committed)
```

Example (`testdata/dvs_logindata.json`):

```json
{
  "testName": "Valid Admin login",
  "role": "admin",
  "emailEnvKey": "DVS_ADMIN_EMAIL",
  "passwordEnvKey": "DVS_ADMIN_PASSWORD",
  "firstLogin": true,
  "expected": "success"
}
```

Important:

- No passwords or temporary passwords are stored here.
- Credentials are resolved from `.env` at runtime via `emailEnvKey` / `passwordEnvKey`.
- `testdata/files/` is intentionally empty until approved synthetic PDFs/JPEGs are supplied.

### 3.6 `api/` — API layer

Why: centralizes API routes and response contracts.

What it stores:

```text
api/
├── endpoints/
│   ├── routes.ts                 # all verified tenant API routes
│   └── platformRoutes.ts         # platform control-plane routes (enterprise tenants)
├── schemas/
│   ├── auth_login_api_schema.json
│   ├── configuration_paper_api_schema.json
│   ├── marking_marks_api_schema.json
│   └── … (60+ schemas)
└── .gitkeep
```

`routes.ts` contains:

- `Routes` — static endpoint constants.
- `RouteBuilders` — helper builders for paths/query strings.
- `RouteMethods` — observed HTTP methods.

Example:

```ts
export const Routes = {
  AUTH_LOGIN: '/api/v1/auth/login',
  CONFIGURATION_PAPERS: '/api/v1/configuration/papers',
  MARKING_MARKS: '/api/v1/marking/evaluations/{evaluationId}/marks',
};
```

Schemas are generated from real responses and validated with AJV.

Example (`api/schemas/auth_login_api_schema.json`):

```json
{
  "type": "object",
  "required": ["user", "tenant", "role", "permissions", "session"],
  "properties": {
    "user": { "type": "object", "required": ["id", "name", "email"] },
    "role": { "type": "string" }
  }
}
```

### 3.7 `docs/` — project documentation

Why: explains the repository to humans.

What it stores:

```text
docs/
├── PROJECT_STRUCTURE.md              # this guide
├── BUG_DVS.md                        # observed defects, appended per run
├── API_TESTING_SUMMARY.md            # API coverage summary
├── testcases/
│   ├── 01-platform-admin.csv         # Platform Admin cases
│   ├── 02-admin.csv                  # University Admin cases
│   ├── 03-chairman.csv               # Chairman cases
│   ├── 04-chief-examiner.csv         # Chief Examiner cases
│   ├── 05-evaluator.csv              # Evaluator cases
│   ├── 06-scanner-operator.csv       # Scanner Operator cases
│   ├── 07-user-manager.csv           # User Manager cases
│   ├── 08-performance-stress-load.csv # perf/load/stress/spike/soak/recovery
│   └── DVS-TESTCASES.xlsx            # combined workbook, one sheet per CSV
└── reports/
    ├── workflow-summary.html         # end-of-flow checklist
    ├── testcases-summary.html        # parallel test-case dashboard
    ├── testcases-summary.md / .json  # machine- and human-readable run summary
    ├── testcase-coverage.md / .json  # documented vs executable coverage
    ├── testcase-pending.csv          # backlog of cases not yet automated
    ├── defects/<role>.md             # this run's defects, merged into BUG_DVS.md
    ├── logs/<role>.log               # per-role parallel execution log
    ├── artifacts/<reportId>/         # Admin result HTML/JSON + summary
    └── DVS-EVALUATION-REPORT-*.xlsx / .csv
```

Parallel test-case results are also written per role:

```text
reports/testcases/<role>/index.html       # Playwright HTML report
reports/testcases/<role>/results.xml      # JUnit XML
custom-report/testcases/<role>/index.html # custom dashboard
test-results/testcases/<role>/            # screenshots, videos, traces
```

Test-case CSVs are the source of truth. Rebuild the workbook with
`npm run testcases:workbook` after editing any CSV. Durable result exports live
under `docs/reports/`; `reports/` belongs to the Playwright HTML reporter and is
cleared between runs.

Add new documentation here instead of cluttering the project root.

### 3.8 `prompts/` — test scenario drivers

Why: tells the framework **what** to test. This is the input for test generation.

What it stores:

```text
prompts/
├── KTR_WEB_TEST_PROMPTS.md       # web workflows per role
├── KTR_API_TEST_PROMPTS.md       # API scenarios
├── KTR_DB_TEST_PROMPTS.md        # DB scenarios
├── utilitis_prompt.md            # utility expectations
└── db.sqlite3                    # read-only reference DB snapshot
```

`KTR_WEB_TEST_PROMPTS.md` includes:

- Role workflows (Admin, Chairman, Chief, Evaluator, Scanner, User Manager).
- Expected results and negative cases.
- Captured UI labels.
- Credential bootstrap rules.

`db.sqlite3` is a read-only reference snapshot. It is not the live application database.

---

## 4. Generated output folders

These folders are written by test runs. They are listed in `.gitignore` and can be regenerated.

### 4.1 `reports/` — standard Playwright reports

Why: human-readable and CI-consumable results.

What it stores:

```text
reports/
├── index.html                # aggregate Playwright HTML report
├── results.xml               # aggregate JUnit XML
└── testcases/
    └── <role>/
        ├── index.html        # per-role Playwright HTML report
        └── results.xml       # per-role JUnit XML
```

Produced by `playwright.config.ts`:

```ts
reporter: [
  ["list"],
  ["html", { open: "never", outputFolder: "reports" }],
  ["junit", { outputFile: "reports/results.xml" }],
  ["./utils/CustomReporter.ts"],
  ["allure-playwright", { outputFolder: "allure-results" }],
]
```

Example `results.xml`:

```xml
<testsuites tests="21" failures="0" skipped="12">
  <testsuite name="web\authentication\role-login-matrix.spec.ts" tests="7">
    <testcase name="@master @web @role Admin sees only its own workspace" />
  </testsuite>
</testsuites>
```

### 4.2 `allure-results/` — raw Allure data

Why: intermediate data for `allure generate`.

What it stores:

- One `<uuid>-result.json` per test.
- `<uuid>-attachment.md`, screenshots, or text attachments when present.

Example (`allure-results/e68303d9-…-result.json`):

```json
{
  "name": "@master @web @admin Scheme / Regulation marks required controls",
  "status": "skipped",
  "statusDetails": {},
  "stage": "finished",
  "labels": [
    { "name": "framework", "value": "playwright" },
    { "name": "package", "value": "web.exam-configuration.…spec.ts" },
    { "name": "tag", "value": "master" }
  ],
  "start": 1793859605265,
  "stop": 1793859605265
}
```

View it with:

```bash
npm run allure:generate
npm run allure:open
```

Those commands create `allure-report/` (not present until generated).

### 4.3 `custom-report/` — custom HTML reporting

Why: project-specific dashboard with charts, steps, screenshots, videos, traces, and history.

What it stores:

```text
custom-report/
├── report_20261109_184320.html   # one file per run
├── index.html                    # redirects to latest run
├── history.html                  # list of all runs
├── .gitkeep
├── screenshots/ videos/ traces/  # created only when failures produce artifacts
└── testcases/<role>/             # isolated per-role dashboard
```

Example `index.html`:

```html
<meta http-equiv="refresh" content="0;url=report_20261109_184320.html">
```

The reporter (`utils/CustomReporter.ts`) also prints a live terminal summary and refreshes the HTML every 5 seconds while tests run.

### 4.4 `test-results/` — Playwright runtime artifacts

Why: debugging evidence for failed or retried tests.

What it stores:

```text
test-results/
├── .last-run.json                         # last run status
└── <test-folder>/                         # present only when a test fails
    ├── test-failed-1.png
    ├── video.webm
    ├── trace.zip
    └── error-context.md
```

Example `.last-run.json`:

```json
{ "status": "passed", "failedTests": [] }
```

Configured in `playwright.config.ts`:

```ts
use: {
  trace: "on-first-retry",
  screenshot: "only-on-failure",
  video: "retain-on-failure",
}
```

### 4.5 `playwright/.auth/` — stored browser sessions

Why: avoids logging in before every test.

What it stores:

- `admin.json` — cookies and localStorage for the Admin session.
- Generated by `tests/auth.setup.ts`.
- Gitignored because it contains live session secrets.

Redacted example:

```json
{
  "cookies": [
    { "name": "sessionid", "value": "<redacted>", "domain": "<tenant>" }
  ],
  "origins": [
    {
      "origin": "https://<tenant>",
      "localStorage": [
        { "name": "admiezo-active-tenant-id", "value": "<redacted>" }
      ]
    }
  ]
}
```

Do not share or commit this file.

### 4.6 `.playwright-cli/` — CLI exploration captures

Why: evidence from interactive Playwright CLI sessions used to discover locators and page structure.

What it stores:

- `console-*.log` — browser console output.
- `page-*.yml` — accessibility snapshots of the page.

Example:

```yaml
- generic [active] [ref=e1]:
  - generic "Loading ADMIEZO" [ref=e3]
  - alert [ref=e4]
```

These are research artifacts, not test inputs.

### 4.7 `node_modules/` — dependencies

Why: installed npm packages.

What it stores:

- Playwright, TypeScript, Faker, AJV, dotenv, Allure, Luxon, pg, xlsx.

Do not edit. Reinstall with `npm ci` (or `npm install`).

### 4.8 `.playwright/` — runtime directory

Why: reserved for Playwright runtime/cache data.

Current state: empty.
Browser binaries normally live in the OS user cache, not here.

---

## 5. Configuration and tooling folders

### 5.1 `.github/` — CI and Copilot instructions

What it stores:

```text
.github/
├── workflows/playwright.yml       # CI pipeline
└── copilot-instructions.md        # Copilot guidance
```

`playwright.yml` runs on push/PR:

1. Checkout.
2. `npm ci`.
3. Install browsers.
4. `npm run typecheck`.
5. `npx playwright test`.
6. Upload `reports/` artifact.

Example trigger:

```yaml
on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]
```

### 5.2 AI assistant configuration folders

These folders do not contain application code. They configure AI coding tools.

| Folder | Stores | Example |
|---|---|---|
| `.claude/` | Claude skills and references | `.claude/skills/playwright-cli/SKILL.md` |
| `.clinerules/` | Cline rules | `caveman.md` |
| `.cursor/` | Cursor rules | `rules/caveman.mdc` |
| `.windsurf/` | Windsurf rules | `rules/caveman.md` |
| `.opencode/` | OpenCode agent instructions | `AGENTS.md` |
| `.commandcode/` | Command Code learned preferences | `taste/taste/taste.md` |

Example rule content:

```markdown
Respond terse like smart caveman. All technical substance stay. Only fluff die.
```

These files influence coding-assistant behavior only. They are safe to keep for tooling consistency.

### 5.3 Root configuration files

| File | Why | Stores |
|---|---|---|
| `.env` | Local runtime config | Platform URL/credentials, tenant URL, Admin credentials, role credentials, API/DB settings |
| `.env.example` | Documentation | Same keys with blank values |
| `package.json` | Project manifest | Scripts and dependencies |
| `package-lock.json` | Reproducible installs | Exact dependency tree |
| `playwright.config.ts` | Test runner config | Projects, reporters, timeouts, trace/video settings |
| `tsconfig.json` | TypeScript config | Strict mode, module resolution, included folders |
| `env_setup.bat` | Windows bootstrap | Installs dependencies and browsers |
| `AGENTS.md` | Agent instructions | Terse-response rules |
| `playwright-mcp-context .md` | Framework rules | Architecture, naming, dependency order |
| `.gitignore` | Repo hygiene | Excludes secrets and generated artifacts |

Example `playwright.config.ts` projects:

```ts
projects: [
  { name: "setup", testMatch: /auth\.setup\.ts/ },
  { name: "first-login", testMatch: /first-login.*\.spec\.ts/ },
  { name: "platform", testMatch: /web[\\/]platform[\\/].*\.spec\.ts/,
    use: { ...devices["Desktop Chrome"], headless: false } },
  { name: "chromium", testIgnore: /first-login.*\.spec\.ts/,
    use: { ...devices["Desktop Chrome"], storageState } },
]
```

Example `.gitignore` entries:

```gitignore
.env
test-results/
allure-results/
playwright/.auth/
custom-report/*
reports/*
```

---

## 6. How a test run flows through the folders

```text
0. npm run test:platform -> Platform Admin provisions a university live;
   the bootstrap completes the Admin first login and writes .env
        ↓
1. playwright.config.ts loads .env
        ↓
2. tests/auth.setup.ts signs in as Admin
        ↓
3. playwright/.auth/admin.json is written
        ↓
4. chromium project starts each spec with that storageState
        ↓
5. Specs use fixtures/pageFixtures.ts
        ↓
6. Fixtures create Page Objects from pages/
        ↓
7. Page Objects drive the live app
        ↓
8. Specs read data from testdata/ and utils/
        ↓
9. Assertions run with expect()
        ↓
10. Results are written to:
    reports/          (HTML + JUnit)
    allure-results/   (raw Allure)
    custom-report/    (custom HTML)
    test-results/     (failure evidence)
```

Simplified execution order:

```text
config → env → setup auth → fixtures → page objects → tests → reporters
```

---

## 7. What is safe to delete / regenerate

| Folder | Regenerable? | Notes |
|---|---|---|
| `reports/` | Yes | Recreated every run |
| `allure-results/` | Yes | Recreated every run |
| `allure-report/` | Yes | Recreated by `npm run allure:generate` |
| `custom-report/` | Yes | Recreated every run; history is lost |
| `test-results/` | Yes | Recreated every run |
| `playwright/.auth/` | Yes | Recreated by `auth.setup.ts` |
| `.playwright-cli/` | Yes | Research captures only |
| `node_modules/` | Yes | Recreated by `npm ci` |
| `testdata/files/` | No | Approved PDF/JPEG assets must be supplied |
| `prompts/db.sqlite3` | No | Reference snapshot |
| `pages/`, `tests/`, `utils/`, `fixtures/`, `api/`, `testdata/*.json` | No | Source of truth |

---

## 8. Common commands

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Run all projects/tests |
| `npm run test:web` | Run tests tagged `@web` |
| `npm run test:first-login` | Run the one-time password-set project |
| `npm run test:platform` | Provision a university from the Platform Admin console (headed) |
| `npm run workflow:all` | Platform bootstrap → API role workflow → live web workflow |
| `npm run test:api` | Run tests tagged `@api` |
| `npm run test:db` | Run tests tagged `@db` |
| `npm run report` | Open `reports/index.html` |
| `npm run allure:generate` | Build `allure-report/` |
| `npm run allure:open` | Open the Allure report |

---

## 9. Security rules for this repository

- Never commit `.env`.
- Never commit `playwright/.auth/admin.json`.
- Never copy temporary passwords into tests, docs, logs, screenshots, or traces.
- Never hard-code a tenant URL; read `WEB_APP_URL` / `DVS_WEB_BASE_URL`.
- Use synthetic data only.
- Mark unverified screens and permissions as blockers, not assumptions.

---

## 10. Quick lookup: where do I put a new file?

| Artifact | Location | Naming |
|---|---|---|
| Page Object | `pages/` | `XxxPage.ts` |
| Fixture wiring | `fixtures/pageFixtures.ts` | add type + `base.extend` entry |
| Web spec | `tests/web/<area>/` | `kebab-case.spec.ts` |
| API spec | `tests/api/` | `kebab-case.spec.ts` |
| DB spec | `tests/db/` | `kebab-case.spec.ts` |
| API route | `api/endpoints/routes.ts` | add to `Routes` |
| JSON schema | `api/schemas/` | `<area>_<endpoint>_api_schema.json` |
| Test data | `testdata/` | `.json` / `.csv` / `.xlsx` |
| Utility | `utils/` | `camelCase.ts` or `PascalCase.ts` |
| Binary fixture | `testdata/files/` | approved synthetic PDF/JPEG |

This guide describes the repository as it exists today. Update it when a new top-level folder is added.
