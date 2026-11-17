/** Small helpers with no dependencies, so the logic modules stay testable. */

/** JSON with sorted keys, so the same arguments always make the same key
 *  whatever order they were written in. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}

/** A short, stable hash for long keys (djb2). Not for security. */
export function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** A unique-enough id for one logical write. Good for telling two writes
 *  apart and for the server to recognise a repeat; not a secret. */
export function newRequestId(now = Date.now(), rnd = Math.random): string {
  return (
    now.toString(36) + "-" +
    Math.floor(rnd() * 0x7fffffff).toString(36) +
    Math.floor(rnd() * 0x7fffffff).toString(36)
  );
}

/** The device's calendar date, YYYY-MM-DD. Work done offline is dated by
 *  when it happened on the phone, not by when it finally reaches the server. */
export function localDate(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential backoff with jitter: base * 2^n, capped, spread +/-25% so a
 *  room of phones that failed together do not all come back together. */
export function backoffMs(attempt: number, baseMs: number, capMs: number, rnd = Math.random): number {
  const raw = Math.min(capMs, baseMs * Math.pow(2, Math.max(0, attempt)));
  return Math.round(raw * (0.75 + 0.5 * rnd()));
}
