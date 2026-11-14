/**
 * Environment settings, validated once at startup. A bad value stops the server with a clear
 * message instead of leaving it "healthy" but unable to work (NaN limits, a random port, ...).
 * An unset or empty variable means "use the default".
 */
import { existsSync, statSync } from "node:fs";

export interface Config {
  port: number;
  dbPath: string;
  staticDir?: string;
  /** proxy hops whose X-Forwarded-For entry is trusted (0 = none) */
  trustProxy: number;
  concurrency: number;
  maxQueue: number;
  runTimeoutMs: number;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("\n"));
  }
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env): Config {
  const problems: string[] = [];
  const raw = (k: string) => {
    const v = env[k]?.trim();
    return v === undefined || v === "" ? undefined : v;
  };
  const int = (k: string, def: number, min: number, max: number): number => {
    const v = raw(k);
    if (v === undefined) return def;
    const n = Number(v);
    if (!/^-?\d+$/.test(v) || !Number.isSafeInteger(n) || n < min || n > max) {
      problems.push(`${k}="${v}" is not a whole number between ${min} and ${max}`);
      return def;
    }
    return n;
  };

  const port = int("PORT", 8080, 1, 65535);
  const trustProxy = int("TRUST_PROXY", 0, 0, 5);
  const concurrency = int("RUN_CONCURRENCY", 2, 1, 16);
  const maxQueue = int("RUN_MAX_QUEUE", 20, 1, 1000);
  const runTimeoutMs = int("RUN_TIMEOUT_MS", 120_000, 1000, 3_600_000);
  const dbPath = raw("DB_PATH") ?? "traffic.db";
  const staticDir = raw("STATIC_DIR");
  if (staticDir !== undefined && !(existsSync(staticDir) && statSync(staticDir).isDirectory())) {
    problems.push(`STATIC_DIR="${staticDir}" is not a directory (build the web app, or leave STATIC_DIR unset to serve the API only)`);
  }
  if (problems.length) throw new ConfigError(problems);
  return { port, dbPath, staticDir, trustProxy, concurrency, maxQueue, runTimeoutMs };
}
