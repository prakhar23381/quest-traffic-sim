import { useEffect, useState } from "react";

const query = () => window.matchMedia("(prefers-color-scheme: dark)");

export function useDarkMode(): boolean {
  const [dark, setDark] = useState(() => query().matches);
  useEffect(() => {
    const q = query();
    const on = () => setDark(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return dark;
}
