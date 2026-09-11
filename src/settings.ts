import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

/**
 * Per-device display preferences.
 *
 * Deliberately local to the phone rather than a doctype: this is one
 * supervisor's eyesight and one pair of gloves, not farm data, and it should
 * not need a round trip - or a connection - to take effect.
 */
export type Settings = {
  /** Percent of the base size. 100 = the design's own sizing. */
  fontScale: number;
  /** Bigger hit targets, for working with gloves on. */
  bigTouch: boolean;
  /** Show the bottom quick bar. */
  bottomNav: boolean;
  /** Ask before submitting an application or a store request. */
  confirmSubmit: boolean;
};

export const DEFAULTS: Settings = {
  fontScale: 100,
  bigTouch: false,
  bottomNav: true,
  confirmSubmit: false,
};

export const FONT_MIN = 85;
export const FONT_MAX = 145;
export const FONT_STEP = 5;

const KEY = "cnp_settings";

// Mirrored in memory so a re-render never waits on storage, and so the
// scaling helpers below can stay synchronous.
let cached: Settings = { ...DEFAULTS };

export function currentSettings(): Settings {
  return cached;
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) cached = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    cached = { ...DEFAULTS };
  }
  notify();
  return cached;
}

export async function saveSettings(next: Settings): Promise<Settings> {
  cached = { ...DEFAULTS, ...next };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // A phone that cannot write preferences should still run with them.
  }
  notify();
  return cached;
}

export async function resetSettings(): Promise<Settings> {
  cached = { ...DEFAULTS };
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* see above */
  }
  notify();
  return cached;
}

/**
 * Scale a font size by the user's preference.
 *
 * Every screen's StyleSheet is built once at module load, so sizes baked into
 * those cannot react to a setting. Screens that should scale call this at
 * render time instead.
 */
export function fs(size: number, scale = cached.fontScale): number {
  return Math.round((size * scale) / 100);
}

/** Vertical padding that grows when big touch targets are on. */
export function pad(base: number, big = cached.bigTouch): number {
  return big ? Math.round(base * 1.35) : base;
}

/**
 * Everyone watching the settings.
 *
 * These are global to the app, so a local useState per component does not
 * work: the Settings screen would update its own copy and the shell that
 * draws the quick bar would never hear about it. One store, many listeners.
 */
type Listener = (s: Settings) => void;
const listeners = new Set<Listener>();

function notify() {
  for (const fn of listeners) fn(cached);
}

/** Read settings and re-render whenever any part of the app changes them. */
export function useSettings(): [Settings, (patch: Partial<Settings>) => Promise<void>, () => Promise<void>] {
  const [settings, setSettings] = useState<Settings>(cached);

  useEffect(() => {
    listeners.add(setSettings);
    // Pick up anything stored before this component mounted.
    loadSettings().then(setSettings);
    return () => { listeners.delete(setSettings); };
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    await saveSettings({ ...cached, ...patch });
  }, []);

  const reset = useCallback(async () => {
    await resetSettings();
  }, []);

  return [settings, update, reset];
}
