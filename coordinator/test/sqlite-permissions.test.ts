/**
 * Owner-only permissions for coordinator SQLite files (#503).
 *
 * These tests exercise real files and the real driver: the previous
 * implementation passed a callback-less `chmod` and silently ignored the
 * resulting no-op, so a unit test that mocked `node:fs` would not have caught
 * the bug.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  openDatabase,
  setSqliteDatabasePermissions,
  sqliteDatabaseFileNames
} from "../src/persistence/db.js";

// Windows maps chmod(2) onto the read-only attribute, not Unix ownership bits,
// so exact 0o600 assertions only apply on POSIX. See coordinator/README.md.
const describePosix = process.platform === "win32" ? describe.skip : describe;

function fileMode(path: string): number {
  return statSync(path).mode & 0o777;
}

describePosix("SQLite owner-only permissions (#503)", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("creates a new database with 0o600 before schema content is written", async () => {
    dir = mkdtempSync(resolve(tmpdir(), "oversync-sqlite-mode-"));
    const filename = resolve(dir, "new.db");

    const db = await openDatabase(`file:${filename}`);
    try {
      expect(fileMode(filename)).toBe(0o600);

      // The schema write above puts the database in WAL mode. Tighten any
      // sidecars that exist; SQLite creates later ones with the DB's mode.
      for (const sidecar of sqliteDatabaseFileNames(filename).slice(1)) {
        if (existsSync(sidecar)) expect(fileMode(sidecar)).toBe(0o600);
      }
    } finally {
      (db as { close(): void }).close();
    }
  });

  it("tightens an existing database file that was world-readable", async () => {
    dir = mkdtempSync(resolve(tmpdir(), "oversync-sqlite-mode-"));
    const filename = resolve(dir, "existing.db");
    writeFileSync(filename, "");
    chmodSync(filename, 0o644);
    expect(fileMode(filename)).toBe(0o644);

    const db = await openDatabase(`file:${filename}`);
    try {
      expect(fileMode(filename)).toBe(0o600);
    } finally {
      (db as { close(): void }).close();
    }
  });

  it("tightens existing WAL, SHM and rollback-journal sidecars", () => {
    dir = mkdtempSync(resolve(tmpdir(), "oversync-sqlite-mode-"));
    const filename = resolve(dir, "sidecars.db");

    setSqliteDatabasePermissions(filename);
    for (const sidecar of sqliteDatabaseFileNames(filename).slice(1)) {
      writeFileSync(sidecar, "sidecar");
      chmodSync(sidecar, 0o644);
      expect(fileMode(sidecar)).toBe(0o644);
    }

    setSqliteDatabasePermissions(filename);

    expect(fileMode(filename)).toBe(0o600);
    for (const sidecar of sqliteDatabaseFileNames(filename).slice(1)) {
      expect(fileMode(sidecar)).toBe(0o600);
    }
  });
});
