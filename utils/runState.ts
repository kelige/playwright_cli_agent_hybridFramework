import * as fs from "fs";
import * as path from "path";

// A parallel university-matrix run gives each tenant its own files so concurrent
// runs cannot overwrite each other's .env or run state. Single-tenant runs keep
// the project defaults.
const ENV_FILE = process.env.DVS_ENV_FILE?.trim()
  ? path.resolve(process.env.DVS_ENV_FILE.trim())
  : path.resolve(__dirname, "..", ".env");
const STATE_FILE = process.env.DVS_STATE_FILE?.trim()
  ? path.resolve(process.env.DVS_STATE_FILE.trim())
  : path.resolve(__dirname, "..", "playwright", ".auth", "dvs-run-state.json");

/**
 * Blanks the given keys in `.env` while keeping the lines in place.
 * Used before provisioning a new university so the previous tenant's URL,
 * administrator and role logins are emptied, then replaced by the new values.
 * Platform, browser and database settings are never in this list and stay intact.
 * @param keys - Environment variable names to reset to an empty value
 */
export function blankEnvKeys(keys: readonly string[]): void {
  if (!fs.existsSync(ENV_FILE)) return;
  const wanted = new Set<string>(keys);
  const seen = new Set<string>();
  const lines = fs.readFileSync(ENV_FILE, "utf-8").split(/\r?\n/);

  const updated = lines.map((line) => {
    const key = line.split("=")[0]?.trim();
    if (!key || !wanted.has(key)) return line;
    seen.add(key);
    return `${key}=`;
  });
  for (const key of wanted) {
    if (!seen.has(key)) updated.push(`${key}=`);
  }
  fs.writeFileSync(ENV_FILE, updated.join("\n"));
}

/**
 * Sets or appends `KEY=value` in `.env` so the Web role-login specs can reuse the
 * accounts provisioned by the API workflow. Other lines are left untouched.
 */
export function upsertEnv(values: Record<string, string>): void {
  const lines = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf-8").split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(values)) {
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (index >= 0) {
      lines[index] = `${key}=${value}`;
    } else {
      lines.push(`${key}=${value}`);
    }
  }
  fs.writeFileSync(ENV_FILE, lines.join("\n"));
}

/**
 * Persists record ids, emails and university metadata (never passwords).
 * Existing entries are merged so the platform bootstrap's `university` block
 * survives later provisioning runs.
 */
export function saveRunState(state: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const existing = fs.existsSync(STATE_FILE)
    ? (JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as Record<string, unknown>)
    : {};
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...existing, ...state }, null, 2));
}

/**
 * Replaces the run state with a fresh university block.
 * Used when a new university is provisioned so the previous tenant's record ids
 * and role emails can never leak into the new run.
 */
export function resetRunState(state: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** Reads the current run state, or an empty object when no run has been saved. */
export function readRunState(): Record<string, unknown> {
  if (!fs.existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}
