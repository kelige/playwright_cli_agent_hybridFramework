import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "node:module";

export type DbEngine = "sqlite" | "postgresql";

export type DbConfig = {
  engine: DbEngine;
  database: string;
  sqlitePath?: string;
  host?: string;
  port?: number;
};

const WRITE_KEYWORDS =
  /\b(insert|update|delete|drop|alter|truncate|create|replace|vacuum|attach|detach|pragma|grant|revoke)\b/i;

type PgClient = {
  connect(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
};

function resolveEngine(): DbEngine {
  const raw = (process.env.DB_ENGINE ?? "sqlite").trim().toLowerCase();
  if (raw === "sqlite" || raw === "sqlite3") return "sqlite";
  if (raw === "postgres" || raw === "postgresql") return "postgresql";
  throw new Error(`Unsupported DB_ENGINE "${raw}". Use sqlite or postgresql.`);
}

export function dbConfig(): DbConfig {
  const engine = resolveEngine();
  if (engine === "sqlite") {
    const sqlitePath = path.resolve(
      process.cwd(),
      process.env.DB_SQLITE_PATH?.trim() || "prompts/db.sqlite3",
    );
    if (!fs.existsSync(sqlitePath)) {
      throw new Error(`DB_SQLITE_PATH not found: ${sqlitePath}`);
    }
    return { engine, database: sqlitePath, sqlitePath };
  }

  const host = process.env.DB_HOST?.trim() || "";
  const database = process.env.DB_NAME?.trim() || "";
  if (!host || !database) {
    throw new Error("Set DB_HOST and DB_NAME (plus DB_PORT, DB_USER, DB_PASSWORD) for postgresql.");
  }
  return {
    engine,
    database,
    host,
    port: Number(process.env.DB_PORT ?? 5432),
  };
}

function assertReadOnly(sql: string): void {
  const statement = sql.trim().replace(/;+\s*$/, "");
  if (statement.includes(";")) {
    throw new Error("Only one read-only statement per query is allowed.");
  }
  if (!/^(select|with)\b/i.test(statement)) {
    throw new Error("Only SELECT/WITH queries are allowed.");
  }
  if (WRITE_KEYWORDS.test(statement)) {
    throw new Error("Write keyword detected; DB tests are read-only.");
  }
}

function toPgPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function sqliteQuery<T>(file: string, sql: string, params: readonly unknown[]): Promise<T[]> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const statement = db.prepare(sql);
    return statement.all(...(params as never[])) as T[];
  } finally {
    db.close();
  }
}

async function postgresQuery<T>(
  config: DbConfig,
  sql: string,
  params: readonly unknown[],
): Promise<T[]> {
  const requirePg = createRequire(__filename);
  const { Client } = requirePg("pg") as { Client: new (options: Record<string, unknown>) => PgClient };
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: process.env.DB_USER?.trim() || undefined,
    password: process.env.DB_PASSWORD ?? undefined,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = 15000");
    const result = await client.query(toPgPlaceholders(sql), [...params]);
    await client.query("COMMIT");
    return result.rows as T[];
  } finally {
    await client.end();
  }
}

export async function executeQuery<T = Record<string, unknown>>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  assertReadOnly(sql);
  const config = dbConfig();
  if (config.engine === "sqlite") {
    return sqliteQuery<T>(config.sqlitePath!, sql, params);
  }
  return postgresQuery<T>(config, sql, params);
}
