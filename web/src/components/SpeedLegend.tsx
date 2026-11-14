import { DARK, LIGHT, SPEED_BINS } from "../lib/scene";
import { useDarkMode } from "../lib/useDarkMode";

export function SpeedLegend({ title }: { title: string }) {
  const P = useDarkMode() ? DARK : LIGHT;
  const labels = SPEED_BINS.map((b, i) => {
    const lo = i ? SPEED_BINS[i - 1]! : 0;
    return b === Infinity ? `${lo}+` : i === 0 ? `< ${b}` : `${lo}–${b}`;
  });
  return (
    <div className="map-legend">
      <b data-tip="Colours show how fast vehicles are moving; flyover decks are drawn above the roads they cross">{title}</b>
      <div>
        {labels.map((l, i) => (
          <span key={l}>
            <i style={{ background: P.speeds[i] }} />
            {l}
          </span>
        ))}
        <span className="unit">km/h</span>
      </div>
      <div>
        <span>
          <i style={{ background: P.closed }} />
          closed
        </span>
        <span>
          <i style={{ background: P.deck, boxShadow: `2px -2px 0 ${P.shadow}` }} />
          flyover deck
        </span>
      </div>
    </div>
  );
}
