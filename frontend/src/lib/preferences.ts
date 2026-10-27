/** Store only non-sensitive UI preferences here (never student data or scores). */
export function readPreference(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try { return window.localStorage.getItem(key) ?? fallback; }
  catch { return fallback; }
}

export function writePreference(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(key, value); }
  catch { /* The in-memory UI state still works when storage is restricted. */ }
}
