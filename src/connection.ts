import * as Network from "expo-network";
import { useEffect, useState } from "react";
import * as debug from "./debuglog";
import { net } from "./core";
import { currentInstanceUrl } from "./instance";

/**
 * Four states, because "it isn't working" has four different answers and they
 * need different things from the person holding the phone:
 *
 *   "online"   - the server has been answering. Nothing to do.
 *   "offline"  - the phone has no network. Keep working; it is all saved and
 *                will send when signal returns.
 *   "busy"     - the server asked the app to slow down. Nothing is wrong with
 *                the phone or the sign-in; the app is waiting its turn and is
 *                working from its saved copy meanwhile.
 *   "noserver" - the phone has signal but the server isn't answering. Walking
 *                around will not help.
 *
 * This is worked out from what the app is already doing - the phone's own
 * network state and how its requests have been going - not by asking the
 * server every few seconds. Asking is something a person does, by tapping the
 * dot.
 */

export type ConnState = "online" | "offline" | "busy" | "noserver" | "checking";

export const CONN_LABEL: Record<ConnState, string> = {
  online: "Connected",
  offline: "No network",
  busy: "Server busy",
  noserver: "Server unreachable",
  checking: "Checking…",
};

export const CONN_DETAIL: Record<ConnState, string> = {
  online: "The server has been answering.",
  offline: "The phone has no network. Everything you do is saved and sent when signal returns.",
  busy: "The server asked the app to slow down. Your work is saved and the app is waiting its turn.",
  noserver: "The phone has signal but the server is not answering. The server may be down.",
  checking: "Checking the connection…",
};

/** One round trip to the server, only ever on request. */
export async function pingServer(timeoutMs = 8000): Promise<{
  ok: boolean; status?: number; ms: number; error?: string;
}> {
  const started = Date.now();
  const url = currentInstanceUrl() + "/api/method/frappe.ping";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    const ms = Date.now() - started;
    // Any HTTP answer means the server is there - even a "busy" one.
    debug.info("ping", `${url} -> HTTP ${res.status} in ${ms}ms`);
    return { ok: true, status: res.status, ms };
  } catch (e) {
    const ms = Date.now() - started;
    const message = (e as Error)?.name === "AbortError" ? `timed out after ${timeoutMs}ms` : (e as Error)?.message || String(e);
    debug.error("ping", `${url} -> ${message}`);
    return { ok: false, ms, error: message };
  } finally {
    clearTimeout(timer);
  }
}

let deviceOnline = true;
let pinged: "ok" | "fail" | null = null;
let state: ConnState = "checking";
const listeners = new Set<(s: ConnState) => void>();
let started = false;
let cooldownTimer: ReturnType<typeof setTimeout> | null = null;

function compute(): ConnState {
  if (!deviceOnline) return "offline";
  if (net.cooldownMs() > 0) return "busy";
  const recentlyFailed = net.lastFailAt > net.lastOkAt && (net.lastFailKind === "network" || net.lastFailKind === "unexpected");
  if (recentlyFailed || pinged === "fail") return "noserver";
  if (net.lastOkAt > 0 || pinged === "ok") return "online";
  return "checking";
}

function refresh() {
  const next = compute();
  if (cooldownTimer) { clearTimeout(cooldownTimer); cooldownTimer = null; }
  if (next === "busy") cooldownTimer = setTimeout(refresh, net.cooldownMs() + 500);
  if (next !== state) {
    state = next;
    for (const fn of listeners) fn(next);
  }
}

function start() {
  if (started) return;
  started = true;
  net.subscribe(() => { pinged = null; refresh(); });
  Network.getNetworkStateAsync()
    .then((s) => { deviceOnline = !!(s.isInternetReachable ?? s.isConnected ?? true); refresh(); })
    .catch(() => {});
  try {
    Network.addNetworkStateListener((s) => {
      deviceOnline = !!(s.isInternetReachable ?? s.isConnected ?? true);
      pinged = null;
      refresh();
    });
  } catch { /* the request outcomes alone still drive the dot */ }
}

export function useConnection(): [ConnState, () => void] {
  const [current, setCurrent] = useState<ConnState>(state);
  useEffect(() => {
    start();
    listeners.add(setCurrent);
    setCurrent(compute());
    return () => { listeners.delete(setCurrent); };
  }, []);
  const recheck = () => {
    if (!deviceOnline || net.cooldownMs() > 0) { refresh(); return; }   // do not ask a server that asked us not to
    state = "checking"; for (const fn of listeners) fn("checking");
    pingServer().then((r) => { pinged = r.ok ? "ok" : "fail"; refresh(); });
  };
  return [current, recheck];
}

export function currentConnection(): ConnState { return state; }
