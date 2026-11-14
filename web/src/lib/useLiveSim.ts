import { useCallback, useEffect, useRef, useState } from "react";
import type { Scenario } from "@traffic/engine";
import type { FrameData } from "../components/MapView";
import type { LiveIn, LiveOut, LiveStats } from "../workers/protocol";

/** Drives the live worker. Frames go into a ref (drawn by the canvas loop); stats into state at ~5 Hz. */
export function useLiveSim(scenario: Scenario | null) {
  const worker = useRef<Worker | null>(null);
  const frameRef = useRef<FrameData | null>(null);
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [speed, setSpeedState] = useState(8);
  const lastStats = useRef(0);
  const wantPlay = useRef(false);

  const send = (m: LiveIn) => worker.current?.postMessage(m);

  useEffect(() => {
    const w = new Worker(new URL("../workers/live.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    w.onmessage = (ev: MessageEvent<LiveOut>) => {
      const m = ev.data;
      if (m.type === "frame") {
        frameRef.current = { buf: m.buf, n: m.n, t: m.stats.t };
        const now = performance.now();
        if (!m.playing || now - lastStats.current > 200) {
          lastStats.current = now;
          setStats(m.stats);
          setPlaying(m.playing);
          if (!m.playing) wantPlay.current = false;
        }
      } else if (m.type === "loaded") {
        setError(null);
        setWarnings(m.warnings);
        if (wantPlay.current) w.postMessage({ type: "play" } satisfies LiveIn);
      } else {
        setError(m.issues);
        setPlaying(false);
      }
    };
    w.postMessage({ type: "speed", speed: 8 } satisfies LiveIn);
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, []);

  // (re)load whenever the scenario changes; keep playing if it was
  useEffect(() => {
    if (!scenario) return;
    const t = setTimeout(() => send({ type: "load", scenario }), 150);
    return () => clearTimeout(t);
  }, [scenario]);

  const play = useCallback(() => {
    wantPlay.current = true;
    setPlaying(true);
    send({ type: "play" });
  }, []);
  const pause = useCallback(() => {
    wantPlay.current = false;
    setPlaying(false);
    send({ type: "pause" });
  }, []);
  const restart = useCallback(() => {
    if (scenario) send({ type: "load", scenario });
  }, [scenario]);
  const step = useCallback((seconds: number) => send({ type: "step", seconds }), []);
  const setSpeed = useCallback((s: number) => {
    setSpeedState(s);
    send({ type: "speed", speed: s });
  }, []);

  return { frameRef, stats, playing, error, warnings, speed, play, pause, restart, step, setSpeed };
}
