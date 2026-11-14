import type { RunResult } from "@traffic/engine";

/** Floats per vehicle in a frame: x, y, hx, hy, speed (m/s), length, layer */
export const VEH_FLOATS = 7;

export type LiveIn =
  | { type: "load"; scenario: unknown }
  | { type: "play" }
  | { type: "pause" }
  /** simulated seconds per wall-clock second; 0 = as fast as possible */
  | { type: "speed"; speed: number }
  | { type: "step"; seconds: number };

export interface LiveStats {
  t: number;
  durationS: number;
  inNetwork: number;
  waiting: number;
  entered: number;
  completed: number;
  removed: number;
  meanSpeedKmh: number;
  /** completed trips per hour over the last sample interval */
  throughputVph: number;
  /** simulated seconds per wall second actually achieved */
  rate: number;
}

export type LiveOut =
  | { type: "loaded"; warnings: string[] }
  | { type: "frame"; buf: Float32Array; n: number; stats: LiveStats; playing: boolean }
  | { type: "error"; issues: string[] };

export type RunIn = { type: "run"; scenario: unknown };
export type RunOut =
  | { type: "progress"; fraction: number }
  | { type: "done"; result: RunResult }
  | { type: "error"; issues: string[] };
