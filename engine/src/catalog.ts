/**
 * The networks a user can pick, with named groups of links that can be switched off
 * together (e.g. "Silk Board Flyover"). Shared by the web app and the server.
 */
import silkBoardScenario from "../../networks/silk-board.json";
import type { NetworkSpec } from "./network";
import type { DemandSpec } from "./networkSim";
import { braess, corridor, flyoverJunction, grid, signalCross } from "./presets";

export interface Toggle {
  id: string;
  label: string;
  /** link ids closed when the toggle is off */
  links: string[];
  description?: string;
}

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  /** real-world network built from OpenStreetMap (attribution required) */
  osm: boolean;
  network: NetworkSpec;
  demand: DemandSpec[];
  toggles: Toggle[];
}

const sb = silkBoardScenario as unknown as { network: NetworkSpec; demand: DemandSpec[] };

const entries: CatalogEntry[] = [
  {
    id: "silk-board",
    name: "Silk Board junction, Bengaluru",
    description:
      "Hosur Road × Outer Ring Road with the Silk Board Flyover and the double-decker flyover, built from OpenStreetMap. Demand is synthetic (not calibrated).",
    osm: true,
    network: sb.network,
    demand: sb.demand,
    toggles: [
      {
        id: "silk-board-flyover",
        label: "Silk Board Flyover",
        links: ["w40696221+", "w40696222+"],
        description: "Hosur Road deck over the junction. With it closed, southbound through traffic has no ground route in the map data.",
      },
      {
        id: "double-decker",
        label: "Double-decker flyover and ramps",
        links: ["w519734960+", "w1299917512+", "w1299917514+", "w1299917517+", "w1301808818+", "w1254771465+"],
      },
    ],
  },
  {
    id: "flyover-junction",
    name: "Flyover over a signalised junction",
    description: "A north–south arterial on a flyover over a signalised crossroads, with service roads to the junction below.",
    osm: false,
    ...flyoverJunction(),
    toggles: [{ id: "flyover", label: "Flyover", links: ["FLY_SB", "FLY_NB"] }],
  },
  {
    id: "signal-cross",
    name: "Signalised crossroads",
    description: "Four arms, two lanes each way, one phase per approach.",
    osm: false,
    ...signalCross(),
    toggles: [],
  },
  {
    id: "grid-3x3",
    name: "3 × 3 signalised grid",
    description: "Nine signalised junctions 250 m apart; through traffic between opposite edges.",
    osm: false,
    ...grid(3),
    toggles: [],
  },
  {
    id: "braess",
    name: "Braess network",
    description: "Two routes with bottlenecks in opposite order. Adding the shortcut makes every trip slower.",
    osm: false,
    ...braess(true),
    toggles: [{ id: "shortcut", label: "Shortcut A → B", links: ["AB"] }],
  },
  {
    id: "corridor",
    name: "Straight corridor",
    description: "A 1 km two-lane road each way: the simplest case.",
    osm: false,
    ...corridor(),
    toggles: [],
  },
];

export const CATALOG: ReadonlyArray<CatalogEntry> = entries;

export function catalogEntry(id: string): CatalogEntry | undefined {
  return entries.find((e) => e.id === id);
}
