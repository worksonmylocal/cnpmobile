import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Which fertilizer programme this device is working against.
 *
 * Most farms only ever have one submitted programme at a time, so this stays
 * invisible for them - nothing to pick, nothing to remember. The moment a
 * farm runs two (a Jan-Jul programme and an Aug-Dec one, say - exactly what
 * Lokitela has today), every screen that lists blocks or rounds has to know
 * which one it is showing, or the two programmes' plans blend into one list
 * with no way to tell them apart.
 *
 * Kept apart from settings and from the session: it is neither a display
 * preference nor who you are, and switching farms or signing out should not
 * silently carry yesterday's programme selection into a context it no
 * longer applies to.
 */

export type ProgrammeOption = {
  name: string;
  season: string;
  farm: string;
  crop: string;
  period_type: string;
  start_month?: string;
  end_month?: string;
};

const KEY = "cnp_selected_programme";

let cached: string | null = null;
let cachedOptions: ProgrammeOption[] = [];
type Listener = (id: string | null, options: ProgrammeOption[]) => void;
const listeners = new Set<Listener>();

function notify() {
  for (const fn of listeners) fn(cached, cachedOptions);
}

export function currentProgramme(): string | null {
  return cached;
}

export function programmeLabel(p: ProgrammeOption): string {
  const period = p.period_type === "Custom Period" && p.start_month && p.end_month
    ? `${p.start_month.slice(0, 3)}–${p.end_month.slice(0, 3)}`
    : "Full year";
  return `${p.season} · ${period}`;
}

export async function loadProgrammeSelection(): Promise<string | null> {
  try {
    cached = await AsyncStorage.getItem(KEY);
  } catch {
    cached = null;
  }
  return cached;
}

export async function saveProgrammeSelection(id: string | null): Promise<void> {
  cached = id;
  try {
    if (id) await AsyncStorage.setItem(KEY, id);
    else await AsyncStorage.removeItem(KEY);
  } catch {
    /* the in-memory value still governs this session even if it can't persist */
  }
  notify();
}

/** Called once the list of available programmes is known, so a stale or
 *  now-invalid selection (the programme was deleted, or this is a fresh
 *  install) resolves itself without the user having to notice or fix it. */
export async function reconcileProgrammeSelection(
  options: ProgrammeOption[]
): Promise<string | null> {
  cachedOptions = options || [];
  if (cached && !cachedOptions.some((o) => o.name === cached)) {
    cached = null; // the one we had picked no longer exists
  }
  if (!cached && cachedOptions.length === 1) {
    // Only one to choose from - there is no decision to ask anyone to make.
    cached = cachedOptions[0].name;
  }
  await saveProgrammeSelection(cached);
  return cached;
}

/** Merge the selection into a call's args, only when one is actually set.
 *  The server-side endpoints that take a `programme` filter ignore it when
 *  absent, same as every other optional filter they already take - so a
 *  single-programme farm is completely unaffected by this existing at all. */
export function withProgramme<T extends object>(args?: T): T & { programme?: string } {
  if (!cached) return (args ?? {}) as T & { programme?: string };
  return { ...(args ?? {}), programme: cached } as T & { programme?: string };
}

export function useProgrammeState(): [string | null, ProgrammeOption[]] {
  // Lightweight subscribe-without-React-import-cycle: screens that need this
  // reactively pull it in via useEffect + useState, same pattern as useConnection.
  return [cached, cachedOptions];
}

export function subscribeProgramme(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
