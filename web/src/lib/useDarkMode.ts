/**
 * Theme: dark by default for everyone (DESIGN.md §2); light only when the visitor asks for it
 * with the header toggle. The choice is a per-viewer convenience kept in localStorage and set
 * as <html data-theme> before first paint (see index.html), so CSS and the canvas agree.
 */
import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";
const KEY = "junction-lab-theme";
const listeners = new Set<() => void>();

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* storage unavailable (private mode): the choice lasts for this page only */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, () => "dark");
}

export function useDarkMode(): boolean {
  return useTheme() === "dark";
}
