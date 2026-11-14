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

  saveScenario(json: string): string {
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
    // keep the store bounded: finished runs are only needed while someone is looking at them
    this.db.prepare("DELETE FROM runs WHERE finished_at IS NOT NULL AND finished_at < ?").run(Date.now() - RUN_RETENTION_MS);
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
