import { backoffMs, shortHash, sleep, stableStringify } from "./util";

/**
 * How the app talks to the server.
 *
 * Every request goes through here, and every failure is sorted into a kind,
 * because the right response differs completely:
 *
 *   network     never got there (or got no answer). Nothing is wrong with the
 *               account or the server; work is saved and sent later.
 *   throttled   the server (or the host in front of it) said slow down. Back
 *               off for as long as it asked, serve saved data meanwhile, and
 *               above all do NOT keep asking - that is how a busy server turns
 *               into a locked-out crew.
 *   cooldown    we are inside such a backoff, so this request was not sent.
 *   server      the server had a problem. Same as throttled, gentler.
 *   auth        the server read the token and rejected it. The only kind that
 *               means "sign in again".
 *   permission  the account may not do that. A real answer, shown as it is.
 *   rejected    the app refused it (validation, not found). Will never succeed
 *               by being retried unchanged.
 *   unexpected  a reply that is not the server speaking - a Wi-Fi sign-in page,
 *               a gateway error page. Treated like no connection, never as a
 *               reason to sign anyone out.
 *
 * Nothing here touches storage, the session or the screen, so it can be
 * tested on its own.
 */

export type ErrorKind =
  | "network" | "throttled" | "cooldown" | "server"
  | "auth" | "permission" | "rejected" | "unexpected";

const TRANSIENT: ErrorKind[] = ["network", "throttled", "cooldown", "server", "unexpected"];

export class ApiError extends Error {
  kind: ErrorKind;
  status?: number;
  retryAfterMs?: number;
  /** The server has no such method - an older server than this app. */
  missingMethod = false;

  constructor(message: string, kind: ErrorKind, extra: Partial<ApiError> = {}) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    Object.assign(this, extra);
  }

  /** Worth trying again later, unchanged. */
  get transient(): boolean { return TRANSIENT.includes(this.kind); }
  /** Set when a write was saved to send later rather than failing. */
  queued = false;
  /** Compatibility with screens written before kinds existed. */
  get isNetworkError(): boolean { return this.kind === "network"; }
  get isAuthError(): boolean { return this.kind === "auth"; }
}

/** Frappe buries the useful sentence inside _server_messages. */
export function serverMessage(data: any): string | null {
  try {
    if (data?._server_messages) {
      const first = JSON.parse(data._server_messages)[0];
      const parsed = typeof first === "string" ? JSON.parse(first) : first;
      if (parsed?.message) return String(parsed.message).replace(/<[^>]+>/g, "");
    }
  } catch {
    /* fall through */
  }
  if (data?.exception) return String(data.exception).split(":").pop()!.trim();
  return null;
}

/** Retry-After is either seconds or a date. */
export function parseRetryAfter(h: string | null | undefined, now = Date.now()): number | undefined {
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, Math.round(secs * 1000));
  const when = Date.parse(h);
  return Number.isFinite(when) ? Math.max(0, when - now) : undefined;
}

export type Classified =
  | { ok: true; data: any }
  | { ok: false; error: ApiError };

/** Sort one HTTP answer into success or a kind of failure. Pure. */
export function classify(
  status: number, bodyText: string, retryAfterHeader?: string | null, now = Date.now(),
): Classified {
  let json: any;
  let isJson = false;
  try {
    json = bodyText ? JSON.parse(bodyText) : undefined;
    isJson = json !== null && typeof json === "object";
  } catch {
    isJson = false;
  }
  const retryAfterMs = parseRetryAfter(retryAfterHeader, now);
  const msg = isJson ? serverMessage(json) : null;
  const fail = (message: string, kind: ErrorKind, extra: Partial<ApiError> = {}): Classified => ({
    ok: false, error: new ApiError(message, kind, { status, retryAfterMs, ...extra }),
  });

  if (isJson) {
    if (status >= 200 && status < 300 && !json.exc && !json.exception) return { ok: true, data: json.message };
    if (status === 401) return fail(msg || "Your sign-in is no longer valid.", "auth");
    if (status === 403) return fail(msg || "You don't have permission to do that.", "permission");
    if (status === 429) return fail(msg || "The server is busy.", "throttled");
    if (status >= 500) return fail(msg || "The server had a problem.", "server");
    const missing = /failed to get method|has no attribute/i.test(msg || json.exception || "");
    return fail(msg || `The server refused that (HTTP ${status}).`, "rejected", { missingMethod: missing });
  }

  // Not JSON: this is not the app answering.
  if (status === 429) return fail("The server is busy.", "throttled");
  if (status >= 500) return fail("The server had a problem.", "server");
  return fail("The server sent a reply the app doesn't understand - check the connection.", "unexpected");
}

/** What to say to a person, never a status code. */
export function friendly(e: unknown, opts: { saved?: boolean } = {}): string {
  const err = e as ApiError;
  const tail = opts.saved ? " Your work is saved on this phone and will send itself." : "";
  switch (err?.kind) {
    case "network": return opts.saved ? "No connection - saved, will send automatically." : "No connection to the server.";
    case "throttled":
    case "cooldown": {
      const s = err.retryAfterMs ? Math.max(1, Math.round(err.retryAfterMs / 1000)) : null;
      return "The server is busy right now." + (s ? ` Trying again in ${s < 90 ? s + "s" : Math.round(s / 60) + " min"}.` : "") + tail;
    }
    case "server": return "The server had a problem." + tail;
    case "unexpected": return "Couldn't reach the server properly - check the connection." + tail;
    case "auth": return "Your sign-in is no longer valid. Sign in again to send your changes.";
    default: return err?.message || "Something went wrong.";
  }
}

export type NetEvent =
  | { type: "ok"; at: number }
  | { type: "fail"; kind: ErrorKind; at: number }
  | { type: "cooldown"; until: number };

export type NetDeps = {
  fetch: (url: string, init: any) => Promise<{
    status: number; headers: { get(n: string): string | null }; text(): Promise<string>;
  }>;
  baseUrl: () => string;
  prefix: string;
  auth: () => { key: string; secret: string } | null;
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  readTimeoutMs?: number;
  writeTimeoutMs?: number;
  maxConcurrent?: number;
  log?: (level: "info" | "warn" | "error", tag: string, msg: string) => void;
};

export type RequestOpts = {
  /** A write: never auto-retried here (the queue owns retries), longer timeout. */
  write?: boolean;
  /** The login call: no token, its own cooldown, never retried. */
  login?: boolean;
  /** Send even inside a backoff - only for a person's deliberate retry. */
  ignoreCooldown?: boolean;
  retries?: number;
};

export class NetClient {
  private cooldown: Record<"api" | "login", number> = { api: 0, login: 0 };
  private failures = 0;
  private serverRun = 0;
  private active = 0;
  private waiters: Array<() => void> = [];
  private inflight = new Map<string, Promise<any>>();
  private listeners = new Set<(e: NetEvent) => void>();
  lastOkAt = 0;
  lastFailAt = 0;
  lastFailKind: ErrorKind | null = null;

  constructor(private d: NetDeps) {}

  private now() { return (this.d.now ?? Date.now)(); }
  private rnd() { return (this.d.random ?? Math.random)(); }

  subscribe(fn: (e: NetEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: NetEvent) { for (const fn of this.listeners) fn(e); }

  /** Milliseconds left of the server-asked-for pause (0 when clear). */
  cooldownMs(scope: "api" | "login" = "api"): number {
    return Math.max(0, this.cooldown[scope] - this.now());
  }

  private startCooldown(scope: "api" | "login", ms: number) {
    const until = this.now() + ms;
    if (until > this.cooldown[scope]) {
      this.cooldown[scope] = until;
      if (scope === "api") this.emit({ type: "cooldown", until });
    }
  }

  /** Forget a backoff, e.g. after a person asks to retry now. */
  clearCooldown() {
    this.cooldown = { api: 0, login: 0 };
    this.failures = 0;
    this.serverRun = 0;
  }

  private async acquire() {
    const max = this.d.maxConcurrent ?? 3;
    if (this.active < max) { this.active++; return; }
    await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
  }
  private release() {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }

  /** One attempt. Throws ApiError. */
  private async attempt(method: string, args: object, opts: RequestOpts): Promise<any> {
    const auth = opts.login ? null : this.d.auth();
    if (!opts.login && !auth) throw new ApiError("You are not signed in.", "auth");

    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const limit = opts.write ? (this.d.writeTimeoutMs ?? 30000) : (this.d.readTimeoutMs ?? 20000);
    const timer = controller ? setTimeout(() => controller.abort(), limit) : null;
    const url = this.d.baseUrl() + this.d.prefix + method;
    let res;
    try {
      res = await this.d.fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Authorization: `token ${auth.key}:${auth.secret}` } : {}),
        },
        body: JSON.stringify(args ?? {}),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (e) {
      const aborted = (e as Error)?.name === "AbortError";
      throw new ApiError(aborted ? "The server took too long to answer." : "No connection to the server.", "network");
    } finally {
      if (timer) clearTimeout(timer);
    }

    let text = "";
    try { text = await res.text(); } catch { throw new ApiError("The connection dropped mid-reply.", "network"); }
    const out = classify(res.status, text, res.headers.get("retry-after"), this.now());
    if (out.ok) return out.data;
    throw out.error;
  }

  private note(err: ApiError | null, scope: "api" | "login") {
    const at = this.now();
    if (!err) {
      this.failures = 0; this.serverRun = 0; this.lastOkAt = at;
      this.emit({ type: "ok", at });
      return;
    }
    this.lastFailAt = at; this.lastFailKind = err.kind;
    this.emit({ type: "fail", kind: err.kind, at });
    if (err.kind === "throttled") {
      // Honour what the server asked for; otherwise grow our own pause, so
      // asking again never becomes the thing that keeps it overloaded.
      const own = backoffMs(this.failures, 8000, 300000, () => this.rnd());
      this.startCooldown(scope, Math.max(err.retryAfterMs ?? 0, own));
      this.failures++;
      err.retryAfterMs = this.cooldownMs(scope);
      this.d.log?.("warn", "net", `throttled - backing off ${Math.round(this.cooldownMs(scope) / 1000)}s`);
    } else if (err.kind === "server") {
      this.serverRun++;
      if (this.serverRun >= 2) {
        this.startCooldown(scope, Math.max(err.retryAfterMs ?? 0, backoffMs(this.serverRun - 2, 10000, 120000, () => this.rnd())));
        err.retryAfterMs = this.cooldownMs(scope);
      }
    } else if (err.kind !== "network") {
      // A real answer of any other kind means the server is alive and well.
      this.serverRun = 0;
    }
  }

  async request<T = any>(method: string, args: object = {}, opts: RequestOpts = {}): Promise<T> {
    const scope: "api" | "login" = opts.login ? "login" : "api";
    if (!opts.ignoreCooldown && this.cooldownMs(scope) > 0) {
      throw new ApiError("The server asked the app to wait.", "cooldown", { retryAfterMs: this.cooldownMs(scope) });
    }

    const key = !opts.write && !opts.login
      ? `${method}|${shortHash(stableStringify(args))}|${this.d.auth()?.key ?? ""}` : null;
    if (key && this.inflight.has(key)) return this.inflight.get(key)!;

    const run = (async () => {
      await this.acquire();
      try {
        const maxRetries = opts.write || opts.login ? 0 : (opts.retries ?? 2);
        for (let n = 0; ; n++) {
          try {
            const data = await this.attempt(method, args, opts);
            this.note(null, scope);
            return data as T;
          } catch (e) {
            const err = e as ApiError;
            this.note(err, scope);
            const retryable = err.kind === "network" || err.kind === "server";
            if (n >= maxRetries || !retryable || this.cooldownMs(scope) > 0) throw err;
            await (this.d.sleep ?? sleep)(backoffMs(n, 800, 4000, () => this.rnd()));
          }
        }
      } finally {
        this.release();
      }
    })();

    if (key) {
      this.inflight.set(key, run);
      run.then(() => this.inflight.delete(key), () => this.inflight.delete(key));
    }
    return run;
  }
}
