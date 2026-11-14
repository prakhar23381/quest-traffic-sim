/**
 * Graceful shutdown. Node as PID 1 ignores SIGTERM unless a handler exists, which made every
 * `docker stop` wait out its grace period and end in SIGKILL.
 */
export interface ShutdownDeps {
  /** stop accepting connections and wait for in-flight requests */
  close: () => Promise<unknown>;
  /** record runs that cannot finish now */
  failUnfinished: (reason: string) => void;
  exit: (code: number) => void;
  log?: (msg: string) => void;
  /** give up waiting for close() after this long */
  graceMs?: number;
}

export function createShutdown(d: ShutdownDeps): (signal: string) => Promise<void> {
  let started = false;
  return async (signal: string) => {
    if (started) return;
    started = true;
    d.log?.(`${signal} received, shutting down`);
    const hardStop = setTimeout(() => d.exit(1), d.graceMs ?? 8000);
    hardStop.unref?.();
    let code = 0;
    try {
      await d.close();
    } catch {
      code = 1;
    }
    try {
      d.failUnfinished("server shut down");
    } catch {
      /* the database may be unavailable (disk full): nothing more to do */
    }
    clearTimeout(hardStop);
    d.exit(code);
  };
}
