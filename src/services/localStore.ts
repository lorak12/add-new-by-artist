/**
 * Tiny localStorage helpers for the extension's persistent cache.
 *
 * Storage format is intentionally compact:
 *  - Arrays stored as delimiter-joined strings (30–50 % smaller than JSON arrays)
 *  - Timestamps as numbers
 *  - Version field for future schema migrations
 */

const PREFIX = "add-new:";

export function lsGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function lsSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (e) {
    // Storage quota exceeded — remove oldest artist caches and retry
    console.warn("[AddNewByArtist] localStorage write failed, evicting old artist caches…");
    evictArtistCaches();
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* give up */ }
  }
}

export function lsDel(key: string): void {
  localStorage.removeItem(PREFIX + key);
}

/** Removes all cached artist scan results (they are just optimisation, not critical). */
function evictArtistCaches(): void {
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(`${PREFIX}a:`)) toRemove.push(k);
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
}
