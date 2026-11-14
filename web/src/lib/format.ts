export const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
};

export const int = (x: number) => Math.round(x).toLocaleString("en-IN");
export const num = (x: number, d = 1) => x.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
export const mins = (s: number) => `${num(s / 60, 1)} min`;
