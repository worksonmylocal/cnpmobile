import type { QItem, FlushResult } from "./queue";
import type { ApiError } from "./net";
import { seedsFromBootstrap } from "./seed";

/**
 * Keeps the phone's saved copy current, and delivers waiting work.
 *
 * The one rule that matters: ask the server as little as possible, and ask
 * less the harder it is struggling. So there is no timer that polls. The
 * engine runs when there is a reason - the app opens or comes back to the
 * front, signal returns, something is waiting to send, a person pulls to
 * refresh, or the saved copy has grown old - and when the server pushes back
 * it stands down for as long as it was told to, then returns gently.
 *
 * Dependencies are passed in so this can be tested without a phone.
 */

export type SyncState = {
  syncing: boolean;
  /** When the saved copy was last refreshed from the server (0 = never). */
  lastSyncAt: number;
  lastError: string | null;
  pending: number;
  failed: number;
  /** When the next attempt is due, if we are waiting (0 = not waiting). */
  nextAttemptAt: number;
  /** The server said wait until then (0 = not asked to). */
  busyUntil: number;
  /** An older server without the one-call refresh; screens fetch for themselves. */
  bootstrapUnsupported: boolean;
};

export type EngineDeps = {
  now: () => number;
  user: () => string | null;
  net: {
    request<T = any>(method: string, args?: object, opts?: object): Promise<T>;
    cooldownMs(): number;
    clearCooldown(): void;
  };
  queue: {
    load(adoptFor?: string): Promise<void>;
    pending(user: string): QItem[];
    failed(user: string): QItem[];
    flush(user: string, send: (i: QItem) => Promise<unknown>, o?: { ignoreBackoff?: boolean }): Promise<FlushResult>;
    nextDueIn(user: string): number | null;
    subscribe(fn: () => void): () => void;
  };
  cache: { setMany(user: string, items: Array<{ method: string; args: unknown; value: unknown }>): Promise<void> };
  send: (item: QItem) => Promise<unknown>;
  programme: {
    current(): string | null;
    /** Settle the selection against the list from the server; returns the programme in force. */
    reconcile(options: any[]): Promise<string | null>;
    fold(programme: string | null | undefined, args?: Record<string, unknown>): Record<string, unknown>;
  };
  store: { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void> };
  timers: { set(fn: () => void, ms: number): unknown; clear(h: unknown): void };
  onAuthExpired?: (expired: boolean) => void;
  log?: (level: "info" | "warn" | "error", tag: string, msg: string) => void;
};

/** How old the saved copy may get before a refresh is due while the app is open. */
export const REFRESH_EVERY_MS = 10 * 60_000;
/** Never refresh the whole copy more often than this unless a person asks. */
export const MIN_GAP_MS = 60_000;

export class SyncEngine {
  state: SyncState = {
    syncing: false, lastSyncAt: 0, lastError: null, pending: 0, failed: 0,
    nextAttemptAt: 0, busyUntil: 0, bootstrapUnsupported: false,
  };
  private listeners = new Set<(s: SyncState) => void>();
  private running: Promise<void> | null = null;
  private timer: unknown = null;
  private kickTimer: unknown = null;
  private started = false;
  private foreground = true;
  private unsubQueue: (() => void) | null = null;

  constructor(private d: EngineDeps) {}

  subscribe(fn: (s: SyncState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private publish() {
    const user = this.d.user();
    this.state = {
      ...this.state,
      pending: user ? this.d.queue.pending(user).length : 0,
      failed: user ? this.d.queue.failed(user).length : 0,
      busyUntil: this.d.net.cooldownMs() > 0 ? this.d.now() + this.d.net.cooldownMs() : 0,
    };
    for (const fn of this.listeners) fn(this.state);
  }

  /** The first refresh, while it is under way - for a screen that has
   *  nothing saved to show and would otherwise fetch for itself. */
  firstRun(): Promise<void> | null {
    if (this.state.lastSyncAt !== 0 || !this.d.user()) return null;
    this.start();
    return this.running;
  }

  /** Begin: look at what is waiting, and refresh if the copy is old. */
  start() {
    if (this.started) return;
    this.started = true;
    this.unsubQueue = this.d.queue.subscribe(() => this.publish());
    void this.syncNow();
  }

  stop() {
    this.started = false;
    this.clearTimers();
    this.unsubQueue?.();
    this.unsubQueue = null;
  }

  setForeground(fg: boolean) {
    this.foreground = fg;
    if (!fg) this.clearTimers();
    else if (this.started) void this.syncNow();
  }

  private clearTimers() {
    if (this.timer) this.d.timers.clear(this.timer);
    if (this.kickTimer) this.d.timers.clear(this.kickTimer);
    this.timer = this.kickTimer = null;
    this.state = { ...this.state, nextAttemptAt: 0 };
  }

  /** Something is waiting to send: go soon, but let a burst of taps settle first. */
  kick() {
    if (!this.started) return;
    if (this.kickTimer) this.d.timers.clear(this.kickTimer);
    this.kickTimer = this.d.timers.set(() => { this.kickTimer = null; void this.syncNow(); }, 900);
  }

  /** Signal came back: the server may be reachable again. */
  networkRestored() {
    if (!this.started) return;
    // A person's phone regaining signal says nothing about a server that asked
    // us to wait, so the backoff is honoured; only the offline-ness is cleared.
    this.kick();
  }

  /**
   * Run now. `force` is a person asking (pull to refresh, Sync now): it
   * overrides the quiet period and any backoff and refreshes everything.
   */
  syncNow(opts: { force?: boolean } = {}): Promise<void> {
    if (this.running) {
      // A person asking mid-way must not be swallowed by a quiet background run.
      return opts.force ? this.running.then(() => this.syncNow({ force: true })) : this.running;
    }
    this.running = this.run(!!opts.force).finally(() => { this.running = null; });
    return this.running;
  }

  private async run(force: boolean) {
    const user = this.d.user();
    if (!user) return;
    this.state = { ...this.state, syncing: true };
    this.publish();
    try {
      await this.d.queue.load(user);
      if (force) { this.d.net.clearCooldown(); this.d.onAuthExpired?.(false); }

      if (!force && this.d.net.cooldownMs() > 0) {
        this.state = { ...this.state, lastError: "The server is busy - waiting before asking again." };
        return;                                     // finally{} schedules the return
      }

      // 1. Deliver what is waiting, oldest first.
      if (this.d.queue.pending(user).length) {
        const r = await this.d.queue.flush(user, this.d.send, { ignoreBackoff: force });
        if (r.stopped === "auth") {
          this.d.onAuthExpired?.(true);
          this.state = { ...this.state, lastError: "Your sign-in is no longer valid." };
          return;
        }
        if (r.stopped === "transient") {
          this.state = { ...this.state, lastError: r.error?.message ?? "Couldn't reach the server." };
          return;                                   // a struggling server is not asked for more
        }
        this.d.onAuthExpired?.(false);
      }

      // 2. Refresh the saved copy, if there is reason to.
      const since = this.d.now() - this.state.lastSyncAt;
      const due = this.state.lastSyncAt === 0 ? (await this.loadLastSync(user)) : since >= REFRESH_EVERY_MS;
      if ((force || due) && !this.state.bootstrapUnsupported) await this.bootstrap(user);
      else if (force && this.state.bootstrapUnsupported) this.state = { ...this.state, lastSyncAt: this.d.now() };
    } catch (e) {
      const err = e as ApiError;
      this.state = { ...this.state, lastError: err?.message ?? "Sync failed." };
      if (err?.kind === "auth") this.d.onAuthExpired?.(true);
    } finally {
      this.state = { ...this.state, syncing: false };
      this.publish();
      this.scheduleNext(user);
    }
  }

  /** True when a refresh is due, going by the last one this phone made. */
  private async loadLastSync(user: string): Promise<boolean> {
    try {
      const raw = await this.d.store.get(`uc3b|${user}`);
      const at = raw ? Number(raw) : 0;
      if (at) this.state = { ...this.state, lastSyncAt: at };
      return !at || this.d.now() - at >= REFRESH_EVERY_MS;
    } catch { return true; }
  }

  /** Fetch everything the screens read in one call, and save it. */
  private async bootstrap(user: string) {
    const selected = this.d.programme.current();
    let first: any;
    try {
      first = await this.d.net.request("get_field_bootstrap", this.d.programme.fold(selected, {}));
    } catch (e) {
      const err = e as ApiError;
      if (err.missingMethod || err.status === 404) {
        // An older server: nothing to refresh in one go. Screens still fetch
        // and save for themselves, they just do it one at a time.
        this.state = { ...this.state, bootstrapUnsupported: true, lastSyncAt: this.d.now() };
        this.d.log?.("info", "sync", "server has no bootstrap yet - screens fetch individually");
        return;
      }
      throw err;
    }

    const programmes: any[] = first.programmes || [];
    const chosen = await this.d.programme.reconcile(programmes);
    const fold = (p: string | null | undefined) => (a?: Record<string, unknown>) => this.d.programme.fold(p, a);

    await this.d.cache.setMany(user, seedsFromBootstrap(first, fold(selected)));
    // A single programme with nothing yet selected: the same data is that
    // programme's, so save it under the key the screens will now use.
    if (chosen && chosen !== selected && programmes.length <= 1) {
      await this.d.cache.setMany(user, seedsFromBootstrap(first, fold(chosen)));
    }
    // More than one programme: have each one ready offline, not just the open one.
    if (programmes.length > 1) {
      for (const p of programmes) {
        if (p.name === selected) continue;
        if (this.d.net.cooldownMs() > 0) break;
        const more = await this.d.net.request("get_field_bootstrap", this.d.programme.fold(p.name, {}));
        await this.d.cache.setMany(user, seedsFromBootstrap(more, fold(p.name)));
      }
    }

    const at = this.d.now();
    this.state = { ...this.state, lastSyncAt: at, lastError: null };
    await this.d.store.set(`uc3b|${user}`, String(at)).catch(() => {});
    this.d.log?.("info", "sync", `refreshed ${programmes.length || 1} programme(s)`);
  }

  /** Decide when to come back - or not to, if there is no reason to. */
  private scheduleNext(user: string) {
    if (!this.started || !this.foreground) return;
    if (this.timer) this.d.timers.clear(this.timer);
    this.timer = null;

    let delay: number | null = null;
    const cool = this.d.net.cooldownMs();
    const waiting = this.d.queue.pending(user).length > 0 ? this.d.queue.nextDueIn(user) : null;

    if (cool > 0) delay = cool + 1500;
    else if (waiting !== null) delay = Math.max(5000, waiting);
    else {
      const age = this.d.now() - this.state.lastSyncAt;
      delay = Math.max(MIN_GAP_MS, REFRESH_EVERY_MS - age);
    }
    this.state = { ...this.state, nextAttemptAt: this.d.now() + delay };
    this.timer = this.d.timers.set(() => { this.timer = null; void this.syncNow(); }, delay);
  }
}
