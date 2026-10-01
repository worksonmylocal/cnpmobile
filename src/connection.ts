import { useEffect, useState } from "react";
import * as Network from "expo-network";
import { currentInstanceUrl } from "./instance";
import * as debug from "./debuglog";

/**
 * Three states, because "it isn't working" has three different answers and
 * they need different actions from the person holding the phone:
 *
 *   "online"  - device has a network and the server answered. Nothing to do.
 *   "offline" - device has no network. Walk somewhere with signal; work is
 *               queued meanwhile.
 *   "noserver"- device has a network but the server did not answer. Signal is
 *               not the problem, so walking around will not help - either the
 *               instance URL is wrong or the server is down.
 *
 * Telling the last two apart is the whole reason expo-network is here: a
 * failed fetch alone cannot distinguish a phone in a dead spot from a server
 * that is refusing connections.
 */

export type ConnState = "online" | "offline" | "noserver" | "checking";

export const CONN_LABEL: Record<ConnState, string> = {
  online: "Connected",
  offline: "No network",
  noserver: "Server unreachable",
  checking: "Checking…",
};

export const CONN_DETAIL: Record<ConnState, string> = {
  online: "The device has signal and the server is answering.",
  offline: "The device has no network. Anything you record is queued and sent when signal returns.",
  noserver: "The device has signal but the server is not answering. Check the instance URL, or the server may be down.",
  checking: "Checking the connection…",
};

/** One round trip to the server, with a timeout so a hung socket cannot
 *  leave the dot stuck on "checking". */
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
    // Any HTTP answer at all means the server is there. 401/403 is a reachable
    // server declining an unauthenticated call, which is still reachable.
    debug.info("ping", `${url} -> HTTP ${res.status} in ${ms}ms`);
    return { ok: true, status: res.status, ms };
  } catch (e) {
    const ms = Date.now() - started;
    const message = (e as Error)?.name === "AbortError"
      ? `timed out after ${timeoutMs}ms`
      : (e as Error)?.message || String(e);
    debug.error("ping", `${url} -> ${message}`);
    return { ok: false, ms, error: message };
  } finally {
    clearTimeout(timer);
  }
}

async function evaluate(): Promise<ConnState> {
  let hasNetwork = true;
  try {
    const state = await Network.getNetworkStateAsync();
    // isInternetReachable is the honest one: connected to a wifi access point
    // that has no route out still reads isConnected true.
    hasNetwork = state.isInternetReachable ?? state.isConnected ?? true;
  } catch {
    /* if we cannot tell, assume there is a network and let the ping decide */
  }
  if (!hasNetwork) return "offline";
  const { ok } = await pingServer();
  return ok ? "online" : "noserver";
}

/**
 * Shared so every screen's dot agrees. One poll loop for the whole app, and
 * the network listener re-checks the moment the radio changes rather than
 * waiting out the interval.
 */
let state: ConnState = "checking";
const listeners = new Set<(s: ConnState) => void>();
let started = false;

function set(next: ConnState) {
  if (next === state) return;
  state = next;
  for (const fn of listeners) fn(next);
}

function start() {
  if (started) return;
  started = true;
  const check = () => { evaluate().then(set).catch(() => set("noserver")); };
  check();
  setInterval(check, 30000);
  try {
    Network.addNetworkStateListener(check);
  } catch {
    /* polling alone is enough if the listener is unavailable */
  }
}

export function useConnection(): [ConnState, () => void] {
  const [current, setCurrent] = useState<ConnState>(state);
  useEffect(() => {
    start();
    listeners.add(setCurrent);
    setCurrent(state);
    return () => { listeners.delete(setCurrent); };
  }, []);
  const recheck = () => { evaluate().then(set).catch(() => set("noserver")); };
  return [current, recheck];
}

export function currentConnection(): ConnState {
  return state;
}
