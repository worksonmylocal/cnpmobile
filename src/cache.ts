import { shortHash, stableStringify } from "./util";

/**
 * The phone's own copy of what the server has told it.
 *
 * Everything a screen reads is kept here, per signed-in user, with the time it
 * was fetched. That is what makes the app usable with no signal at all, and
 * what lets it stop asking the server the same question every time someone
 * opens a screen: a recent answer is simply used, an older one is shown at
 * once while a fresh one is fetched, and only a missing one waits for the
 * network.
 *
 * Keyed by user so two people sharing a phone never see each other's data.
 */

export interface KV {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
  removeItem(k: string): Promise<void>;
}

export type CacheEntry<T = any> = {
  v: T;
  /** When the server gave us this answer. */
  at: number;
  method: string;
  args: unknown;
  /** Something has changed since; fetch again, but keep showing this meanwhile. */
  stale?: boolean;
};

/** How long an answer is trusted without asking again. Short for things that
 *  change as people work, long for things that barely change. */
export const TTL_MS: Record<string, number> = {
  get_home_metrics: 90_000,
  get_store_requests: 60_000,
  get_upcoming_and_overdue: 180_000,
  get_block_progress: 300_000,
  get_sections_with_pending_work: 180_000,
  get_pending_plans_for_section: 180_000,
  get_pending_plans_for_block: 180_000,
  get_sections_with_issued_work: 120_000,
  get_issued_blocks_in_section: 120_000,
  get_issued_request_for_plan: 180_000,
  get_my_applicators_by_section: 120_000,
  get_attendance_by_block: 120_000,
  get_applicators_for_block: 180_000,
  get_all_sections: 3_600_000,
  get_blocks_in_section: 3_600_000,
  get_field_programmes: 1_800_000,
  get_operator_activity: 300_000,
  // A search box: always ask, but keep the last answer for when there's no signal.
  get_available_employees_for_team: 0,
};
export const DEFAULT_TTL_MS = 180_000;
export const ttlFor = (method: string) => TTL_MS[method] ?? DEFAULT_TTL_MS;

const MAX_ENTRIES = 600;

export class DataCache {
  private mem = new Map<string, CacheEntry>();
  private listeners = new Set<(keys: string[]) => void>();

  constructor(private kv: KV, private now: () => number = Date.now) {}

  key(user: string, method: string, args: unknown): string {
    const a = stableStringify(args ?? {});
    return `uc3|${user}|${method}|${a.length > 100 ? shortHash(a) + ":" + a.length : a}`;
  }
  private indexKey(user: string) { return `uc3i|${user}`; }

  subscribe(fn: (keys: string[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(keys: string[]) { for (const fn of this.listeners) fn(keys); }

  private async readIndex(user: string): Promise<Record<string, number>> {
    try { return JSON.parse((await this.kv.getItem(this.indexKey(user))) || "{}"); } catch { return {}; }
  }
  private async writeIndex(user: string, idx: Record<string, number>) {
    // Keep the newest MAX_ENTRIES; drop the rest from storage too.
    const keys = Object.keys(idx);
    if (keys.length > MAX_ENTRIES) {
      const drop = keys.sort((a, b) => idx[a] - idx[b]).slice(0, keys.length - MAX_ENTRIES);
      for (const k of drop) { delete idx[k]; this.mem.delete(k); await this.kv.removeItem(k).catch(() => {}); }
    }
    await this.kv.setItem(this.indexKey(user), JSON.stringify(idx)).catch(() => {});
  }

  /** Synchronous look at what is already in memory. */
  peek<T = any>(user: string, method: string, args: unknown): CacheEntry<T> | null {
    return (this.mem.get(this.key(user, method, args)) as CacheEntry<T>) ?? null;
  }

  async get<T = any>(user: string, method: string, args: unknown): Promise<CacheEntry<T> | null> {
    const k = this.key(user, method, args);
    const hit = this.mem.get(k);
    if (hit) return hit as CacheEntry<T>;
    try {
      const raw = await this.kv.getItem(k);
      if (!raw) return null;
      const e = JSON.parse(raw) as CacheEntry<T>;
      this.mem.set(k, e);
      return e;
    } catch {
      return null;
    }
  }

  /** Age in ms, or Infinity when nothing is stored. */
  age(e: CacheEntry | null): number { return e ? Math.max(0, this.now() - e.at) : Infinity; }
  isFresh(e: CacheEntry | null, method: string): boolean {
    return !!e && !e.stale && this.age(e) < ttlFor(method);
  }

  async setMany(user: string, items: Array<{ method: string; args: unknown; value: unknown }>) {
    if (!items.length) return;
    const idx = await this.readIndex(user);
    const at = this.now();
    const keys: string[] = [];
    for (const it of items) {
      const k = this.key(user, it.method, it.args);
      const e: CacheEntry = { v: it.value, at, method: it.method, args: it.args };
      this.mem.set(k, e);
      idx[k] = at;
      keys.push(k);
      try { await this.kv.setItem(k, JSON.stringify(e)); } catch { /* full storage: memory still serves this session */ }
    }
    await this.writeIndex(user, idx);
    this.emit(keys);
  }
  async set(user: string, method: string, args: unknown, value: unknown) {
    await this.setMany(user, [{ method, args, value }]);
  }

  /** Mark answers as old so the next read fetches fresh ones - but keep them
   *  to show meanwhile. After a write, the things it changed are stale. */
  async invalidate(user: string, methods?: string[]) {
    const idx = await this.readIndex(user);
    const touched: string[] = [];
    for (const k of Object.keys(idx)) {
      const method = k.split("|")[2];
      if (methods && !methods.includes(method)) continue;
      const e = this.mem.get(k) ?? (await this.getRaw(k));
      if (!e) continue;
      e.stale = true;
      this.mem.set(k, e);
      touched.push(k);
      try { await this.kv.setItem(k, JSON.stringify(e)); } catch { /* ignore */ }
    }
    if (touched.length) this.emit(touched);
  }
  private async getRaw(k: string): Promise<CacheEntry | null> {
    try { const raw = await this.kv.getItem(k); return raw ? JSON.parse(raw) : null; } catch { return null; }
  }

  /** Every stored answer for a method, whatever its arguments. */
  async all<T = any>(user: string, method: string): Promise<Array<CacheEntry<T>>> {
    const idx = await this.readIndex(user);
    const out: Array<CacheEntry<T>> = [];
    for (const k of Object.keys(idx)) {
      if (k.split("|")[2] !== method) continue;
      const e = this.mem.get(k) ?? (await this.getRaw(k));
      if (e) { this.mem.set(k, e); out.push(e as CacheEntry<T>); }
    }
    return out;
  }

  async purge(user: string) {
    const idx = await this.readIndex(user);
    for (const k of Object.keys(idx)) { this.mem.delete(k); await this.kv.removeItem(k).catch(() => {}); }
    await this.kv.removeItem(this.indexKey(user)).catch(() => {});
    // ...and when it was last refreshed, so the next sign-in fetches afresh.
    await this.kv.removeItem(`uc3b|${user}`).catch(() => {});
    this.emit([]);
  }
}
