import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_BASE_URL } from "./config";

/**
 * Which server this device talks to.
 *
 * Kept out of the session on purpose: logging out ends who you are, not which
 * installation you belong to. A supervisor who signs out at the end of a shift
 * should not have to retype a URL to sign back in, and typing one wrongly on a
 * phone keyboard is the easiest way to be told your password is wrong when it
 * isn't. So this is stored separately from the session and survives
 * clearSession().
 */

const KEY = "cnp_instance_url";

let cached: string | null = null;

/** Trim, drop a trailing slash, and assume https when no scheme is given. */
export function normalizeUrl(raw: string): string {
  let url = (raw || "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return url.replace(/\/+$/, "");
}

export function looksLikeUrl(raw: string): boolean {
  const url = normalizeUrl(raw);
  return /^https?:\/\/[^\s/.]+\.[^\s/]+/i.test(url);
}

export async function loadInstanceUrl(): Promise<string> {
  if (cached) return cached;
  let resolved = DEFAULT_BASE_URL;
  try {
    const stored = await AsyncStorage.getItem(KEY);
    resolved = normalizeUrl(stored || "") || DEFAULT_BASE_URL;
  } catch {
    /* unreadable storage falls back to the shipped default */
  }
  cached = resolved;
  return resolved;
}

export async function saveInstanceUrl(raw: string): Promise<string> {
  const url = normalizeUrl(raw) || DEFAULT_BASE_URL;
  cached = url;
  try {
    await AsyncStorage.setItem(KEY, url);
  } catch {
    /* a device that cannot persist it still works for this session */
  }
  return url;
}

/**
 * Synchronous read for the request path. loadInstanceUrl() runs during boot,
 * before anything can call the API, so by the time this matters the value is
 * there; the default is only a safety net.
 */
export function currentInstanceUrl(): string {
  return cached || DEFAULT_BASE_URL;
}

export function isDefaultInstance(): boolean {
  return currentInstanceUrl() === DEFAULT_BASE_URL;
}
