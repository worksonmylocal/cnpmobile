/**
 * A small in-memory record of what the app just did.
 *
 * The point is diagnosing a problem someone else hit: a supervisor says "it
 * won't let me record", and without this the only evidence is whatever they
 * remember of a toast that has already gone. Every API call and every failure
 * lands here, so the whole exchange can be read back off the device.
 *
 * In memory only, and capped. It holds request URLs, method names and error
 * text - never the session token or a password, because nothing here is ever
 * handed the token in the first place.
 */

export type Level = "info" | "warn" | "error";

export type Entry = {
  at: number;
  level: Level;
  tag: string;
  message: string;
};

const MAX = 200;
const entries: Entry[] = [];
type Listener = (e: Entry[]) => void;
const listeners = new Set<Listener>();

export function log(level: Level, tag: string, message: string) {
  entries.push({ at: Date.now(), level, tag, message: String(message).slice(0, 500) });
  // Drop the oldest rather than growing without bound - a phone left running
  // for a week must not accumulate a log it cannot render.
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  for (const fn of listeners) fn(snapshot());
}

export const info = (tag: string, m: string) => log("info", tag, m);
export const warn = (tag: string, m: string) => log("warn", tag, m);
export const error = (tag: string, m: string) => log("error", tag, m);

export function snapshot(): Entry[] {
  return entries.slice().reverse();   // newest first, which is what you read
}

export function clear() {
  entries.length = 0;
  for (const fn of listeners) fn([]);
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** One line per entry, for copying out of the app. */
export function asText(): string {
  return snapshot()
    .map((e) => {
      const t = new Date(e.at).toISOString().slice(11, 19);
      return `${t} ${e.level.toUpperCase().padEnd(5)} ${e.tag}: ${e.message}`;
    })
    .join("\n");
}
