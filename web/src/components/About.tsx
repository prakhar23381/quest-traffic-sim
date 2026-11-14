const REPO = "https://github.com/prakhar23381/quest-traffic-sim";

export function About() {
  return (
    <article className="about">
      <h2>About the model</h2>
      <p>
        Every vehicle is simulated individually (an <em>agent</em>), four times per simulated second. The same TypeScript engine runs in your browser for the live view
        and on the server for full runs, and both give bit-identical results.
      </p>

      <h3>How vehicles behave</h3>
      <ul>
        <li>
          <b>Car following:</b> the Intelligent Driver Model (Treiber et al., 2000). Each driver has a desired speed (from the speed limit, ±10 % between drivers), a 1 s time
          gap, comfortable acceleration of 1.5 m/s² and braking of 2 m/s².
        </li>
        <li>
          <b>Lane changes:</b> MOBIL. Drivers move into the lane their route needs up to four junctions ahead, change lanes when it gains them speed without making the car
          behind brake hard, and let merging vehicles in.
        </li>
        <li>
          <b>Junctions:</b> each turn has its own path through the junction, and paths that cross or merge conflict. At signals, drivers decide to stop or go when the light
          changes, from whether they can stop comfortably. At give-way junctions they accept a gap of 3 s. Flyovers and underpasses are separate levels, so they never conflict
          with the junction they cross.
        </li>
        <li>
          <b>Routes:</b> fastest route at departure, using the travel times measured on each road at that moment; vehicles stuck for a long time look for another route.
        </li>
        <li>
          <b>Narrow lanes</b> are driven more slowly with longer gaps: 70 % of the speed at 2.5 m, full speed from 3.5 m.
        </li>
      </ul>

      <h3>How it was checked</h3>
      <table>
        <thead>
          <tr>
            <th>What</th>
            <th>Reference</th>
            <th>Simulation</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Queue discharge at a green light</td>
            <td>HCM 1,900; Indian Roads Congress ≈ 1,840 veh/h/lane</td>
            <td>1,935 veh/h/lane</td>
          </tr>
          <tr>
            <td>Signal capacity</td>
            <td>1,488 veh/h, predicted before measuring</td>
            <td>1,439 (−3 %)</td>
          </tr>
          <tr>
            <td>Signal delay</td>
            <td>Webster's formula</td>
            <td>within 3 s for 20–80 % load</td>
          </tr>
          <tr>
            <td>Flyover over a busy junction</td>
            <td>through traffic unaffected</td>
            <td>6 s delay vs over 200 s below</td>
          </tr>
          <tr>
            <td>Braess's paradox</td>
            <td>a new road can slow everyone</td>
            <td>≥ 20 % slower with the shortcut</td>
          </tr>
        </tbody>
      </table>
      <p>
        Every step the engine also checks that no two vehicles overlap, that crossing paths are never used at once and that no vehicle is lost. The full report is in{" "}
        <a href={`${REPO}/blob/main/docs/VALIDATION.md`} target="_blank" rel="noreferrer">
          docs/VALIDATION.md
        </a>
        .
      </p>

      <h3>Limits: read results as comparisons, not forecasts</h3>
      <ul>
        <li>
          <b>Demand is synthetic</b>, not calibrated against traffic counts. Compare scenarios on the same network; do not read the numbers as predictions for the real junction.
        </li>
        <li>
          <b>Silk Board map data</b> lacks many lane counts and speed limits (filled in by road class) and has no turn-lane markings; small residential streets are left out.
          With the Silk Board Flyover closed, southbound through traffic has no ground route in the map data, so those trips are reported as "no route".
        </li>
        <li>
          <b>Cars only</b>, driving in lanes: no two-wheelers, buses, pedestrians, U-turns or lane filtering.
        </li>
        <li>
          <b>Side roads</b> joining a saturated main road get less capacity than the Highway Capacity Manual predicts, and signals lose about 4.6 s at the start of each green
          (HCM: about 2 s).
        </li>
        <li>
          <b>Safety valves:</b> a vehicle stuck at the head of a queue for 5 minutes is removed (gridlock relief), and one stuck in a lane that cannot make its turn for 3 minutes is
          removed. Both are counted in the results, never hidden.
        </li>
      </ul>
      <p>
        Model details:{" "}
        <a href={`${REPO}/blob/main/docs/MODEL.md`} target="_blank" rel="noreferrer">
          docs/MODEL.md
        </a>{" "}
        · Source:{" "}
        <a href={REPO} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </p>

      <h3>Data</h3>
      <p>
        Silk Board road network © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, available under the Open Database Licence (ODbL).
      </p>
    </article>
  );
}
