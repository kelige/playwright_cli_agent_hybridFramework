import * as fs from "fs";
import * as path from "path";

const ENV_FILE = path.resolve(__dirname, "..", ".env");
const STATE_FILE = path.resolve(__dirname, "..", "playwright", ".auth", "dvs-run-state.json");

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

/** Persists record ids and emails (never passwords) produced by a workflow run. */
export function saveRunState(state: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
