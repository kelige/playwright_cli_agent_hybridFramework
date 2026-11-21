#!/usr/bin/env node
/**
 * Fails the CI job before Playwright starts when `.env` is missing or incomplete.
 *
 * Every spec guards itself with `test.skip(...)` when its environment is absent,
 * so a blank `.env` turns the whole suite into skips and still reports a green
 * build. This check turns that silent outcome into an explicit failure.
 *
 * Two stages, because this framework has two kinds of configuration:
 *
 *   platform  Fixed values: PLATFORM_URL, the platform admin, the base domain and
 *             the standard role password. Safe to store in a CI credential.
 *
 *   tenant    Per-university values: WEB_APP_URL, the tenant Admin and the role
 *             logins. Provisioning writes these for a brand-new university on
 *             every run, so they must never come from a credential.
 *
 * Usage:
 *   node scripts/ci-preflight.mjs test:master
 *   node scripts/ci-preflight.mjs test:platform --require=platform
 *   node scripts/ci-preflight.mjs testcases --require=tenant
 *   node scripts/ci-preflight.mjs test:db --env=.env.ci
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const args = process.argv.slice(2);
const suite = args.find((argument) => !argument.startsWith("--")) ?? "test:master";
const envArg = args.find((argument) => argument.startsWith("--env="))?.split("=")[1];
const requireArg = args.find((argument) => argument.startsWith("--require="))?.split("=")[1];
const envPath = path.resolve(process.cwd(), envArg ?? ".env");

const fail = (lines) => {
  for (const line of lines) console.error(line);
  process.exit(1);
};

if (!fs.existsSync(envPath)) {
  fail([
    `✖ ${envPath} not found.`,
    "  Seed it from the CI credential, or copy .env.example and fill it in.",
  ]);
}

dotenv.config({ path: envPath, override: false, quiet: true });

const read = (key) => (process.env[key] ?? "").trim();

const PLATFORM_KEYS = [
  "PLATFORM_URL",
  "PLATFORM_ADMIN_EMAIL",
  "PLATFORM_ADMIN_PASSWORD",
  "PLATFORM_BASE_DOMAIN",
  "DVS_ROLE_NEW_PASSWORD",
  // programme.spec.ts gates on DVS_ENV, and provisioning does not write it.
  "DVS_ENV",
];
const TENANT_KEYS = ["WEB_APP_URL", "DVS_ADMIN_EMAIL", "DVS_ADMIN_PASSWORD"];
// The per-role suites sign in as every role, so their logins must exist too.
const ROLE_KEYS = [
  "DVS_USER_MANAGER_EMAIL",
  "DVS_USER_MANAGER_PASSWORD",
  "DVS_CHAIRMAN_EMAIL",
  "DVS_CHAIRMAN_PASSWORD",
  "DVS_CHIEF_EMAIL",
  "DVS_CHIEF_PASSWORD",
  "DVS_EVALUATOR_EMAIL",
  "DVS_EVALUATOR_PASSWORD",
  "DVS_SCANNER_EMAIL",
  "DVS_SCANNER_PASSWORD",
];
// `@master`, `@smoke` and `@datadriven` all include role-login-matrix, which
// skips itself when a role's email/password pair is missing.
const roleSuites = ["test:master", "test:smoke", "test:datadriven", "testcases"];

const platformSuites = ["test:platform", "test:platform-bootstrap", "test:matrix"];
const tenantSuites = [
  "test:smoke",
  "test:sanity",
  "test:regression",
  "test:master",
  "test:web",
  "test:datadriven",
  "test:api",
  "testcases",
];
const dbSuites = ["test:db", "test:db:debug"];

if (!platformSuites.includes(suite) && !tenantSuites.includes(suite) && !dbSuites.includes(suite)) {
  fail([
    `✖ Unknown suite "${suite}".`,
    "  Use one of: test:smoke, test:sanity, test:regression, test:master, test:web, test:api,",
    "  test:db, test:datadriven, test:platform, test:platform-bootstrap, test:matrix, testcases.",
  ]);
}

// `--require` lets the pipeline check the platform keys before provisioning and
// the tenant keys after it. `test:db` reads the database only, so it needs
// neither.
const need = requireArg ?? (dbSuites.includes(suite) ? "db" : platformSuites.includes(suite) ? "platform" : "tenant");

let required = [];
if (need === "platform") {
  required = PLATFORM_KEYS;
} else if (need === "tenant") {
  required = [...TENANT_KEYS];
  if (roleSuites.includes(suite)) required.push(...ROLE_KEYS);
}

const missing = required.filter((key) => !read(key));

if (dbSuites.includes(suite)) {
  const engine = (read("DB_ENGINE") || "sqlite").toLowerCase();
  if (engine === "postgresql" || engine === "postgres") {
    for (const key of ["DB_HOST", "DB_NAME"]) if (!read(key)) missing.push(key);
  } else {
    const file = read("DB_SQLITE_PATH") || "prompts/db.sqlite3";
    if (!fs.existsSync(path.resolve(process.cwd(), file))) {
      missing.push(`DB_SQLITE_PATH (${file} not found)`);
    }
  }
}

if (missing.length > 0) {
  const hint =
    need === "platform"
      ? [
          "  These are the fixed platform values and belong in the CI credential.",
          "  Add a Jenkins Secret file credential holding them and set ENV_CREDENTIAL_ID.",
        ]
      : [
          "  These are per-university values written by provisioning, never by a credential.",
          "  Set PROVISION_UNIVERSITY=true so this build creates a university first.",
        ];
  fail([
    `✖ .env is missing values required by "${suite}" (stage: ${need}):`,
    ...missing.map((key) => `    - ${key}`),
    "",
    "  Without these, every spec hits its test.skip(...) guard and the build is green with 0 tests run.",
    ...hint,
  ]);
}

if (need === "platform" && read("DVS_ALLOW_WRITES") !== "true") {
  console.warn(
    `⚠ DVS_ALLOW_WRITES is "${read("DVS_ALLOW_WRITES") || "(blank)"}". ` +
      "State-changing specs (provisioning, programme creation, policy saves) will skip.",
  );
}

console.log(`✔ .env satisfies "${suite}" at stage "${need}" (${required.length} key(s) present).`);
