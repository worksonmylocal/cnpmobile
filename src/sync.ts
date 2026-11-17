import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Network from "expo-network";
import { AppState } from "react-native";
import { hooks, sendQueued } from "./api";
import { cache, currentUser, net, queue, setAuthExpired } from "./core";
import * as debug from "./debuglog";
import { foldProgramme, reconcileProgrammeSelection, currentProgramme } from "./programme";
import { SyncEngine } from "./syncEngine";

/**
 * Runs the sync engine on the phone: starts it when someone is signed in,
 * and tells it when the app comes to the front or signal returns. Nothing
 * here polls.
 */

export const engine = new SyncEngine({
  now: Date.now,
  user: currentUser,
  net,
  queue,
  cache,
  send: sendQueued,
  programme: {
    current: currentProgramme,
    reconcile: (options) => reconcileProgrammeSelection(options),
    fold: (p, a) => foldProgramme(p, a),
  },
  store: {
    get: (k) => AsyncStorage.getItem(k),
    set: (k, v) => AsyncStorage.setItem(k, v),
  },
  timers: {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
  onAuthExpired: setAuthExpired,
  log: (level, tag, msg) => debug.log(level, tag, msg),
});

// A write that was queued, or one that got through while others waited, is a
// reason to look at the queue - never to refresh everything.
hooks.firstSync = () => engine.firstRun();
hooks.onQueued = () => engine.kick();
hooks.onWritten = () => { if (currentUser() && queue.pending(currentUser()!).length) engine.kick(); };

let subscriptions: Array<{ remove(): void }> = [];

export function startSync() {
  stopSync();
  engine.start();
  let wasConnected = true;
  subscriptions.push(
    AppState.addEventListener("change", (s) => engine.setForeground(s === "active")),
    Network.addNetworkStateListener((st) => {
      const connected = !!(st.isInternetReachable ?? st.isConnected);
      if (connected && !wasConnected) engine.networkRestored();
      wasConnected = connected;
    }),
  );
}

export function stopSync() {
  engine.stop();
  for (const s of subscriptions) { try { s.remove(); } catch { /* already gone */ } }
  subscriptions = [];
}

/** A person asked (pull to refresh, Sync now): ask the server regardless. */
export function syncNow() { return engine.syncNow({ force: true }); }
