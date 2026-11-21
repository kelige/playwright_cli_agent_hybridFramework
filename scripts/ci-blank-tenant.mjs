#!/usr/bin/env node
/**
 * Blanks the per-university values in `.env` so a build always starts clean.
 *
 * The CI credential holds only the fixed platform section. Tenant values
 * (WEB_APP_URL, the Admin and every role login) describe one specific
 * university and are written by provisioning for a brand-new university on
 * every run. If an older `.env` still carries them, the run would quietly test
 * the previous university instead of the one just created.
 *
 * Platform, browser and database settings are never in this list.
 *
 * Usage:
 *   node scripts/ci-blank-tenant.mjs
 *   node scripts/ci-blank-tenant.mjs --env=.env.ci
 */
import fs from "node:fs";
import path from "node:path";

const TENANT_KEYS = new Set([
  "WEB_APP_URL",
  "DVS_WEB_BASE_URL",
  "DVS_BASE_URL",
  "DVS_API_BASE_URL",
  "DVS_API_TOKEN",
  "DVS_TENANT_ID",
  "DVS_TENANT_NAME",
  "DVS_ADMIN_EMAIL",
  "DVS_ADMIN_PASSWORD",
  "DVS_ADMIN_TEMP_PASSWORD",
  "DVS_UNIVERSITY_NAME",
  "DVS_UNIVERSITY_CODE",
  "DVS_UNIVERSITY_ADMIN_EMAIL",
  "DVS_UNIVERSITY_ADMIN_PASSWORD",
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
]);

const args = process.argv.slice(2);
const envArg = args.find((argument) => argument.startsWith("--env="))?.split("=")[1];
const envPath = path.resolve(process.cwd(), envArg ?? ".env");

if (!fs.existsSync(envPath)) {
  console.error(`✖ ${envPath} not found.`);
  process.exit(1);
}

const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
let cleared = 0;
let touched = 0;

const updated = lines.map((line) => {
  const key = line.split("=")[0]?.trim();
  if (!key || !TENANT_KEYS.has(key)) return line;
  touched += 1;
  const value = line.slice(line.indexOf("=") + 1).trim();
  if (value === "") return line;
  cleared += 1;
  return `${key}=`;
});

fs.writeFileSync(envPath, updated.join("\n"));

console.log(
  `✔ ${path.basename(envPath)}: blanked ${cleared} stale tenant value(s) ` +
    `of ${touched} tenant key(s). Platform settings untouched.`,
);
