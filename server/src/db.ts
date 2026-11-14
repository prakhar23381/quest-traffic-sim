/** SQLite storage for scenarios and runs. On the free host the disk is ephemeral; scenarios are also shareable by URL. */
import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";

export type RunStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface RunRow {
  id: string;
  scenario_id: string | null;
  status: RunStatus;
  progress: number;
  created_at: number;
  finished_at: number | null;
  result: string | null;
  error: string | null;
}

/** finished runs older than this are deleted */
export const RUN_RETENTION_MS = 24 * 3600 * 1000;
/** saved scenarios older than this are deleted (short links are best-effort; the URL hash always works) */
export const SCENARIO_RETENTION_MS = 7 * 24 * 3600 * 1000;
/** hard caps, so one client cannot grow the database without bound */
export const MAX_SCENARIOS = 5000;
export const MAX_RUNS = 500;

export const newId = (): string => randomBytes(9).toString("base64url");

export class Store {
  readonly db: Database.Database;

  constructor(path = ":memory:") {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scenarios (
        id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, scenario_id TEXT, scenario_json TEXT NOT NULL, status TEXT NOT NULL,
        progress REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, finished_at INTEGER,
        result TEXT, error TEXT
      );
    `);
    // Runs interrupted by a restart can never finish.
    this.db.prepare("UPDATE runs SET status = 'failed', error = 'server restarted' WHERE status IN ('queued', 'running')").run();
  }

  /** Delete expired rows, then the oldest beyond the caps. Cheap: both tables stay small. */
  prune(now = Date.now()): void {
    this.db.prepare("DELETE FROM runs WHERE finished_at IS NOT NULL AND finished_at < ?").run(now - RUN_RETENTION_MS);
    this.db.prepare("DELETE FROM scenarios WHERE created_at < ?").run(now - SCENARIO_RETENTION_MS);
    this.db
      .prepare("DELETE FROM scenarios WHERE id IN (SELECT id FROM scenarios ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?)")
      .run(MAX_SCENARIOS - 1);
    this.db
      .prepare("DELETE FROM runs WHERE finished_at IS NOT NULL AND id IN (SELECT id FROM runs WHERE finished_at IS NOT NULL ORDER BY finished_at DESC, rowid DESC LIMIT -1 OFFSET ?)")
      .run(MAX_RUNS - 1);
  }

  /** Runs that were queued or running when the process stops can never finish. */
  failUnfinished(reason: string): void {
    this.db.prepare("UPDATE runs SET status = 'failed', error = ?, finished_at = ? WHERE status IN ('queued', 'running')").run(reason, Date.now());
  }

  saveScenario(json: string): string {
    this.prune();
    const id = newId();
    this.db.prepare("INSERT INTO scenarios (id, created_at, json) VALUES (?, ?, ?)").run(id, Date.now(), json);
    return id;
  }

  getScenario(id: string): string | null {
    const row = this.db.prepare("SELECT json FROM scenarios WHERE id = ?").get(id) as { json: string } | undefined;
    return row?.json ?? null;
  }

  createRun(scenarioJson: string, scenarioId: string | null): string {
    const id = newId();
    this.prune();
    this.db
      .prepare("INSERT INTO runs (id, scenario_id, scenario_json, status, created_at) VALUES (?, ?, ?, 'queued', ?)")
      .run(id, scenarioId, scenarioJson, Date.now());
    return id;
  }

  setProgress(id: string, progress: number): void {
    this.db.prepare("UPDATE runs SET status = 'running', progress = ? WHERE id = ?").run(progress, id);
  }

  finishRun(id: string, status: Exclude<RunStatus, "queued" | "running">, result: string | null, error: string | null): void {
    this.db
      .prepare("UPDATE runs SET status = ?, progress = CASE WHEN ? = 'done' THEN 1 ELSE progress END, result = ?, error = ?, finished_at = ? WHERE id = ?")
      .run(status, status, result, error, Date.now(), id);
  }

  getRun(id: string): RunRow | null {
    return (this.db.prepare("SELECT id, scenario_id, status, progress, created_at, finished_at, result, error FROM runs WHERE id = ?").get(id) as RunRow | undefined) ?? null;
  }
}
