/** Line icons, 1.75 px strokes in currentColor, so they follow the text colour and theme. */
const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

/**
 * The Junction Lab mark: a ground road (muted, broken where it passes underneath) crossed by
 * a flyover deck (full strength) — grade separation, the thing the app is about.
 */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={2.3}>
      <path d="M2.5 15.5h4.6M13.4 15.5h8.1" opacity={0.45} />
      <path d="M4 21.5C9.5 15.5 13.5 9 20 2.5" />
    </svg>
  );
}

export function Sun() {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </svg>
  );
}

export function Moon() {
  return (
    <svg {...base}>
      <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />
    </svg>
  );
}

export function LinkIcon() {
  return (
    <svg {...base} width={16} height={16}>
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
    </svg>
  );
}
