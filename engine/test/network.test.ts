import { describe, expect, it } from "vitest";
import { buildNetwork, corridor, flyoverJunction, grid, signalCross, signalState, laneWidthFactor } from "../src/index";

describe("network builder", () => {
  it("presets build without warnings", () => {
    for (const p of [corridor(), signalCross(), flyoverJunction(), grid()]) {
      expect(buildNetwork(p.network).warnings).toEqual([]);
    }
  });

  it("crossroads: left turns from the kerb lane, right turns from the outer lane, through from all", () => {
    const net = buildNetwork(signalCross().network);
    // From the north arm heading south: east is to the driver's left.
    expect(net.movementById.get("NC+>EC-")!.turn).toBe("left");
    expect(net.movementById.get("NC+>EC-")!.inLanes).toEqual([0]);
    expect(net.movementById.get("NC+>SC-")!.turn).toBe("through");
    expect(net.movementById.get("NC+>SC-")!.inLanes).toEqual([0, 1]);
    expect(net.movementById.get("NC+>WC-")!.turn).toBe("right");
    expect(net.movementById.get("NC+>WC-")!.inLanes).toEqual([1]);
    // No U-turns.
    expect(net.movementById.has("NC+>NC-")).toBe(false);
  });

  it("crossroads: perpendicular through movements conflict; parallel lanes of one movement do not", () => {
    const net = buildNetwork(signalCross().network);
    const ns = net.movementById.get("NC+>SC-")!.connectors;
    const ew = net.movementById.get("EC+>WC-")!.connectors;
    for (const a of ns) for (const b of ew) {
      expect(a.conflicts.some((c) => c.other === b && c.kind === "cross")).toBe(true);
    }
    expect(ns[0]!.conflicts.some((c) => c.other === ns[1])).toBe(false);
  });

  it("flyover: the deck has no movements at the junction it passes over", () => {
    const net = buildNetwork(flyoverJunction().network);
    const C = net.nodeById.get("C")!;
    expect(C.inLinks.map((l) => l.id)).not.toContain("FLY_SB");
    expect(C.movements.some((m) => m.inLink.id.startsWith("FLY") || m.outLink.id.startsWith("FLY"))).toBe(false);
    expect(net.linkById.get("FLY_SB")!.layer).toBe(1);
    // It only connects at its ramps.
    expect(net.movementById.has("NNd+>FLY_SB")).toBe(true);
    expect(net.movementById.has("FLY_SB>SdS+")).toBe(true);
  });

  it("flyover landing: service road keeps the kerb lanes, flyover the outer lanes, one shared", () => {
    const net = buildNetwork(flyoverJunction().network);
    const svc = net.movementById.get("SVC_S_SB>SdS+")!.connectors.map((c) => c.outLane.index);
    const fly = net.movementById.get("FLY_SB>SdS+")!.connectors.map((c) => c.outLane.index);
    expect(svc).toEqual([0, 1]);
    expect(fly).toEqual([1, 2]);
  });

  it("closed links are flagged and unknown ids warn", () => {
    const net = buildNetwork(corridor().network, { closedLinks: ["AB+", "nope"] });
    expect(net.linkById.get("AB+")!.closed).toBe(true);
    expect(net.warnings.some((w) => w.includes("nope"))).toBe(true);
  });

  it("narrow lanes reduce the desired speed", () => {
    expect(laneWidthFactor(3.5)).toBe(1);
    expect(laneWidthFactor(2.5)).toBeCloseTo(0.7);
    expect(laneWidthFactor(3.0)).toBeCloseTo(0.85);
    const p = corridor();
    for (const l of p.network.links) l.laneWidth = 3.0;
    const net = buildNetwork(p.network);
    expect(net.links[0]!.v0).toBeCloseTo((50 / 3.6) * 0.85, 6);
  });
});

describe("signals", () => {
  it("cycles green → amber → all-red per phase and is red for other phases", () => {
    const net = buildNetwork(signalCross(300, 2, 25).network);
    const sig = net.nodeById.get("C")!.signal!;
    expect(sig.cycle).toBe(4 * (25 + 3 + 2));
    const m = "NC+>SC-"; // phase 1
    expect(signalState(sig, m, 0)).toBe("green");
    expect(signalState(sig, m, 24.9)).toBe("green");
    expect(signalState(sig, m, 25)).toBe("amber");
    expect(signalState(sig, m, 28)).toBe("red"); // all-red
    expect(signalState(sig, m, 60)).toBe("red");
    expect(signalState(sig, m, 120)).toBe("green"); // next cycle
    // Exactly one approach is green at any time in split phasing.
    for (let t = 0; t < 120; t += 0.5) {
      const greens = ["N", "E", "S", "W"].filter((d) => signalState(sig, `${d}C+>${d === "N" ? "S" : "N"}C-`, t) === "green");
      expect(greens.length).toBeLessThanOrEqual(1);
    }
  });

  it("unsignalised default plan serves every movement", () => {
    const net = buildNetwork(grid(2).network);
    for (const n of net.nodes) {
      if (!n.signal) continue;
      const served = new Set(n.signal.phases.flatMap((p) => [...p.movements]));
      for (const m of n.movements) expect(served.has(m.id)).toBe(true);
    }
  });
});
