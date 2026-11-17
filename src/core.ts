import AsyncStorage from "@react-native-async-storage/async-storage";
import { currentSession } from "./auth";
import { DataCache } from "./cache";
import { API_PREFIX } from "./config";
import * as debug from "./debuglog";
import { currentInstanceUrl } from "./instance";
import { NetClient } from "./net";
import { WriteQueue } from "./queue";

/**
 * The app's one network client, one saved copy of the server's answers and one
 * queue of unsent work. Built once, here, so every screen shares them.
 */

export const net = new NetClient({
  fetch: (url, init) => fetch(url, init) as any,
  baseUrl: currentInstanceUrl,
  prefix: API_PREFIX,
  auth: () => {
    const s = currentSession();
    return s ? { key: s.api_key, secret: s.api_secret } : null;
  },
  log: (level, tag, msg) => debug.log(level, tag, msg),
});

export const cache = new DataCache(AsyncStorage);
export const queue = new WriteQueue(AsyncStorage);

export function currentUser(): string | null {
  return currentSession()?.user ?? null;
}

/**
 * Whether the server has rejected the saved sign-in. Kept apart from the
 * session on purpose: a rejected token does not log anyone out or throw their
 * saved data away - it puts up a notice, and everything they did keeps
 * waiting until they sign in again.
 */
let authExpired = false;
const authListeners = new Set<(v: boolean) => void>();
export function isAuthExpired() { return authExpired; }
export function setAuthExpired(v: boolean) {
  if (v === authExpired) return;
  authExpired = v;
  for (const fn of authListeners) fn(v);
}
export function subscribeAuth(fn: (v: boolean) => void): () => void {
  authListeners.add(fn);
  return () => { authListeners.delete(fn); };
}
