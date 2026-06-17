/**
 * SQLite test helpers for real-backend e2e tests.
 *
 * These helpers allow tests to read DB state directly (for assertions) and
 * to seed state (for test setup) without going through the Tauri IPC layer.
 *
 * IMPORTANT: Only use for test setup/teardown assertions. Never use to
 * simulate user actions — that bypasses the application's audit and
 * lifecycle guarantees and produces false-positive tests.
 *
 * Usage:
 *   import { openDb, closeDb, queryRows } from "../helpers/db";
 *
 *   const db = await openDb();
 *   const rows = await queryRows(db, "SELECT * FROM projects");
 *   await closeDb(db);
 *
 * Dependencies: The `better-sqlite3` package is listed as a dev dependency
 * here but is not yet installed. Install with:
 *   pnpm --filter @astro-plan/desktop add --save-dev better-sqlite3 @types/better-sqlite3
 *
 * Until that dependency is available, individual tests that need DB assertions
 * should use the Tauri IPC (if the feature is real-backend-accessible) or
 * skip the DB assertion layer.
 */

import path from "node:path";
import { homedir } from "node:os";

/** Path to the Tauri app's SQLite database on Linux/WSL. */
export function defaultDbPath(): string {
  return path.join(
    homedir(),
    ".local",
    "share",
    "dev.astro-plan.astro-library-manager",
    "alm.db",
  );
}

/**
 * Placeholder type for a DB connection.
 * Replace with `import type Database from 'better-sqlite3'` once the
 * dependency is installed.
 */
export type DbConnection = {
  /** Execute a SELECT and return all rows. */
  query: (sql: string, params?: unknown[]) => unknown[];
  /** Close the connection. */
  close: () => void;
};

/**
 * Open a read-only SQLite connection to the app database.
 *
 * This is intentionally a synchronous open (better-sqlite3 is synchronous)
 * wrapped in an async signature for API consistency with the rest of the
 * e2e helpers.
 *
 * Returns null if better-sqlite3 is not installed — callers should
 * skip DB assertions in that case.
 */
export async function openDb(dbPath?: string): Promise<DbConnection | null> {
  const filePath = dbPath ?? defaultDbPath();
  try {
    // Dynamic import so the file compiles even without the package installed.
    const { default: Database } = (await import(
      "better-sqlite3"
    )) as typeof import("better-sqlite3");
    const db = new Database(filePath, { readonly: true });
    return {
      query: (sql: string, params: unknown[] = []) =>
        db.prepare(sql).all(...params),
      close: () => db.close(),
    };
  } catch {
    // better-sqlite3 not installed or DB file not present.
    return null;
  }
}

/** Close a DB connection opened with `openDb`. */
export async function closeDb(db: DbConnection | null): Promise<void> {
  db?.close();
}

/**
 * Query rows from the app database.
 * Returns an empty array if the connection is unavailable.
 */
export async function queryRows(
  db: DbConnection | null,
  sql: string,
  params: unknown[] = [],
): Promise<unknown[]> {
  if (!db) return [];
  return db.query(sql, params);
}
