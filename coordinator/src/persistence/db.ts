import { chmodSync, closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { Pool, PoolClient } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load `node:sqlite` via createRequire so Vite/Vitest do not try to
// transform the import. This module is built into Node 22.5+/24.x and
// is the recommended zero-install SQLite driver.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");
export type Database = InstanceType<typeof DatabaseSync> | PostgresDatabase;
export function isPostgresDatabase(db: Database): db is PostgresDatabase {
  return (db as any).getPool !== undefined;
}

/**
 * Files SQLite may create for a database at `filename`.
 *
 * `-wal` and `-shm` belong to WAL mode (the coordinator's default) and
 * `-journal` belongs to the rollback journal used while a write transaction
 * is in flight. Both can contain the same sensitive order state as the main
 * database file.
 */
export function sqliteDatabaseFileNames(filename: string): string[] {
  return [filename, `${filename}-wal`, `${filename}-shm`, `${filename}-journal`];
}

/**
 * Create the SQLite database file (if needed) with owner-only permissions and
 * tighten the mode of an existing file plus any journal/WAL sidecars.
 *
 * This runs before the schema or any order data is written, so a newly created
 * database is never briefly world-readable. `openSync(..., "a", 0o600)` creates
 * a missing file without truncating an existing one; `chmodSync` then tightens
 * an existing file (the mode passed to `open` is ignored for existing files).
 *
 * Permission errors are intentionally not swallowed: if owner-only access
 * cannot be established, the coordinator must not continue writing order state
 * to a database other local users may be able to read.
 *
 * Platform note: on POSIX systems the mode is enforced as Unix permissions. On
 * Windows, Node maps the mode onto the read-only attribute and does not change
 * the file's NTFS ACLs; see `coordinator/README.md` for the documented handling.
 */
export function setSqliteDatabasePermissions(filename: string): void {
  const fd = openSync(filename, "a", 0o600);
  closeSync(fd);
  chmodSync(filename, 0o600);

  // SQLite creates the sidecars lazily. Tighten whichever ones already exist;
  // ones created later inherit the database file's mode from SQLite itself.
  for (const sidecar of sqliteDatabaseFileNames(filename).slice(1)) {
    if (existsSync(sidecar)) chmodSync(sidecar, 0o600);
  }
}

/**
 * PostgreSQL wrapper to provide a SQLite-like interface.
 */
export class PostgresDatabase {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  prepare(sql: string): PostgresStatement {
    return new PostgresStatement(this.pool, sql);
  }

  async exec(sql: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(sql);
    } finally {
      client.release();
    }
  }

  getPool(): Pool {
    return this.pool;
  }
}

/**
 * PostgreSQL statement wrapper to provide a SQLite-like interface.
 */
export class PostgresStatement {
  constructor(private pool: Pool, private sql: string) {}

  private convertSqliteToPostgres(sql: string, params: any[]): { sql: string; params: any[] } {
    let index = 1;
    let converted = sql.replace(
      /CAST\(strftime\('%s','now'\) AS INTEGER\)/g,
      "CAST(EXTRACT(EPOCH FROM NOW()) AS INTEGER)"
    );
    const paramMap: { [key: string]: any } = {};

    // Extract named parameters
    const namedParams = converted.match(/:(\w+)/g) || [];
    namedParams.forEach((param) => {
      const name = param.slice(1);
      if (params.length > 0 && typeof params[0] === 'object' && params[0] !== null && !(params[0] instanceof Array)) {
        paramMap[name] = params[0][name];
      }
    });

    // Handle named parameters like :publicId, :direction, etc.
    converted = converted.replace(/:(\w+)/g, () => {
      return `$${index++}`;
    });

    // Also handle ? placeholders
    const questionMarks = converted.match(/\?/g)?.length ?? 0;
    if (questionMarks > 0) {
      index = 1;
      converted = converted.replace(/\?/g, () => {
        return `$${index++}`;
      });
      return { sql: converted, params };
    }

    // Convert paramMap to positional array
    const positionalParams: any[] = [];
    namedParams.forEach((param) => {
      const name = param.slice(1);
      positionalParams.push(paramMap[name]);
    });

    return { sql: converted, params: positionalParams.length > 0 ? positionalParams : params };
  }

  run(...params: any[]): { changes: number; lastInsertRowid: number } {
    throw new Error(
      "PostgresStatement.run() should not be called synchronously. Use runAsync() instead."
    );
  }

  get(...params: any[]): any {
    throw new Error(
      "PostgresStatement.get() should not be called synchronously. Use getAsync() instead."
    );
  }

  all(...params: any[]): any[] {
    throw new Error(
      "PostgresStatement.all() should not be called synchronously. Use allAsync() instead."
    );
  }

  /**
   * Async versions for Postgres.
   */
  async runAsync(...params: any[]): Promise<{ changes: number; lastInsertRowid: number }> {
    const { sql, params: convertedParams } = this.convertSqliteToPostgres(this.sql, params);
    const result = await this.pool.query(sql, convertedParams);
    return { changes: result.rowCount || 0, lastInsertRowid: 0 };
  }

  async getAsync(...params: any[]): Promise<any> {
    const { sql, params: convertedParams } = this.convertSqliteToPostgres(this.sql, params);
    const result = await this.pool.query(sql, convertedParams);
    return result.rows[0] || null;
  }

  async allAsync(...params: any[]): Promise<any[]> {
    const { sql, params: convertedParams } = this.convertSqliteToPostgres(this.sql, params);
    const result = await this.pool.query(sql, convertedParams);
    return result.rows;
  }
}

/**
 * Open (or create) the coordinator's database and apply the
 * schema. The schema is idempotent so calling this on an existing DB
 * is safe.
 *
 * Supports both SQLite (file: URLs) and Postgres (postgres:// URLs).
 *
 * The DB is treated as a CACHE of on-chain state. If it is lost or
 * corrupted, the coordinator can rebuild it by re-reading events from
 * both chains.
 */
export async function openDatabase(url: string): Promise<Database> {
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return openPostgresDatabase(url);
  } else {
    return openSqliteDatabase(url);
  }
}

function openSqliteDatabase(url: string): Database {
  const filename = url.startsWith("file:") ? url.slice("file:".length) : url;
  const isMemory = filename === ":memory:" || filename === "";

  // Secure the file before the driver opens it: opening creates the file and
  // applying the schema writes order-table content immediately.
  if (!isMemory) setSqliteDatabasePermissions(filename);

  const db = new DatabaseSync(filename);
  const schema = readFileSync(resolve(__dirname, "schema.sql"), "utf8");
  db.exec(schema);

  // WAL/SHM files are usually created by the schema write above. Re-run after
  // the schema so those sidecars are tightened in the same startup pass.
  if (!isMemory) setSqliteDatabasePermissions(filename);
  return db;
}

async function openPostgresDatabase(url: string): Promise<PostgresDatabase> {
  const { Pool } = (await import("pg")) as typeof import("pg");
  const pool = new Pool({ connectionString: url });

  // Apply migrations
  const migrationsDir = resolve(__dirname, "..", "..", "migrations");
  const migrationFiles = [
    // Add migrations in order. For now, just the initial migration.
    "001_initial.sql",
    "002_chain_cursors.sql"
  ];

  for (const file of migrationFiles) {
    const migrationPath = resolve(migrationsDir, file);
    const migration = readFileSync(migrationPath, "utf8");
    const client = await pool.connect();
    try {
      await client.query(migration);
    } catch (error: any) {
      // Ignore "already exists" errors from CREATE TABLE IF NOT EXISTS
      if (!error.message?.includes("already exists")) {
        throw error;
      }
    } finally {
      client.release();
    }
  }

  return new PostgresDatabase(pool);
}

