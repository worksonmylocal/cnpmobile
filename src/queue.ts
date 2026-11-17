import type { KV } from "./cache";
import { ApiError, ErrorKind } from "./net";
import { backoffMs, newRequestId, localDate } from "./util";

/**
 * Work done with no signal, waiting to be sent.
 *
 * A write that could not be delivered is kept here, in order, and sent when
 * the server can be reached - under the same request id it first went out
 * with, so if the first attempt actually did arrive (and only the reply was
 * lost) the server recognises the repeat instead of doing it twice.
 *
 * Two rules keep this from making things worse:
 *   - only a transient failure is retried, and each item backs off for longer
 *     every time, so a struggling server is asked less, not more;
 *   - an item the server refuses outright (not allowed, not valid) is parked
 *     as "failed" for a person to look at, never retried forever in silence.
 *
 * Items belong to the user who made them and are only ever sent as that user.
 */

export type QItem = {
  id: string;
  user: string;
  method: string;
  args: Record<string, unknown>;
  /** What a screen needs to show this item before it is sent. */
  meta?: Record<string, unknown>;
  createdAt: number;
  /** The phone's calendar date when it was made. */
  date: string;
  attempts: number;
  nextAt: number;
  status: "pending" | "failed";
  error?: string;
  kind?: ErrorKind;
};

export type FlushResult = {
  synced: number;
  sent: QItem[];
  /** Why it stopped early, if it did. */
  stopped?: "transient" | "auth";
  error?: ApiError;
};

const KEY = "uc3q";
const OLD_KEY = "uc_offline_queue";

export class WriteQueue {
  private items: QItem[] = [];
  private ready: Promise<void> | null = null;
  private flushing: Promise<FlushResult> | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private kv: KV,
    private now: () => number = Date.now,
    private rnd: () => number = Math.random,
  ) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() { for (const fn of this.listeners) fn(); }

  /** Read storage once. `adoptFor` is the signed-in user: the old queue had no
   *  owner, and its items can only have been made by whoever used the phone. */
  load(adoptFor?: string): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        try { this.items = JSON.parse((await this.kv.getItem(KEY)) || "[]"); } catch { this.items = []; }
        try {
          const old = JSON.parse((await this.kv.getItem(OLD_KEY)) || "[]") as Array<{ method: string; args: object; ts: number }>;
          if (old.length && adoptFor) {
            for (const o of old) this.items.push(this.make(adoptFor, o.method, o.args as any, undefined, undefined, o.ts));
            await this.kv.removeItem(OLD_KEY).catch(() => {});
            await this.persist();
          }
        } catch { /* nothing to migrate */ }
        this.emit();
      })();
    }
    return this.ready;
  }

  private make(user: string, method: string, args: Record<string, unknown>,
               id?: string, meta?: Record<string, unknown>, at?: number): QItem {
    const t = at ?? this.now();
    return {
      id: id ?? newRequestId(t, this.rnd), user, method, args, meta,
      createdAt: t, date: localDate(new Date(t)), attempts: 0, nextAt: 0, status: "pending",
    };
  }

  private async persist() {
    try { await this.kv.setItem(KEY, JSON.stringify(this.items)); } catch { /* memory still holds it */ }
  }

  list(user: string): QItem[] { return this.items.filter((i) => i.user === user); }
  pending(user: string): QItem[] { return this.list(user).filter((i) => i.status === "pending"); }
  failed(user: string): QItem[] { return this.list(user).filter((i) => i.status === "failed"); }

  async enqueue(user: string, method: string, args: Record<string, unknown>,
                opts: { id?: string; meta?: Record<string, unknown>; date?: string } = {}): Promise<QItem> {
    await this.load();
    const item = this.make(user, method, args, opts.id, opts.meta);
    if (opts.date) item.date = opts.date;
    this.items.push(item);
    await this.persist();
    this.emit();
    return item;
  }

  async remove(id: string) {
    this.items = this.items.filter((i) => i.id !== id);
    await this.persist();
    this.emit();
  }

  /** Put failed items back in line (all of the user's, or one). */
  async retryFailed(user: string, id?: string) {
    for (const i of this.items) {
      if (i.user === user && i.status === "failed" && (!id || i.id === id)) {
        i.status = "pending"; i.attempts = 0; i.nextAt = 0; i.error = undefined; i.kind = undefined;
      }
    }
    await this.persist();
    this.emit();
  }

  /** Milliseconds until the next item is due (0 = now), or null when empty. */
  nextDueIn(user: string): number | null {
    const p = this.pending(user);
    if (!p.length) return null;
    return Math.max(0, Math.min(...p.map((i) => i.nextAt)) - this.now());
  }

  /**
   * Send what is waiting, oldest first. `send` delivers one item and throws an
   * ApiError if it cannot. Stops at the first transient failure (everything
   * after it would fail the same way, and asking again is exactly what a
   * struggling server does not need); parks refusals and carries on.
   */
  flush(user: string, send: (item: QItem) => Promise<unknown>,
        opts: { ignoreBackoff?: boolean } = {}): Promise<FlushResult> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      await this.load();
      const result: FlushResult = { synced: 0, sent: [] };
      for (const item of this.pending(user)) {
        if (!opts.ignoreBackoff && item.nextAt > this.now()) { result.stopped = "transient"; break; }
        try {
          await send(item);
          this.items = this.items.filter((i) => i.id !== item.id);
          result.synced++; result.sent.push(item);
          await this.persist();
          this.emit();
        } catch (e) {
          const err = e as ApiError;
          item.attempts += 1;
          item.error = err.message; item.kind = err.kind;
          if (err.kind === "auth") {
            await this.persist(); this.emit();
            result.stopped = "auth"; result.error = err; break;
          }
          if (err.transient) {
            item.nextAt = this.now() + Math.max(err.retryAfterMs ?? 0, backoffMs(item.attempts - 1, 15000, 600000, this.rnd));
            await this.persist(); this.emit();
            result.stopped = "transient"; result.error = err; break;
          }
          item.status = "failed";
          await this.persist(); this.emit();
        }
      }
      return result;
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }
}
