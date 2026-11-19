import { currentSession, saveSession } from "./auth";
import { cache, currentUser, net, queue, setAuthExpired } from "./core";
import * as debug from "./debuglog";
import { ApiError, friendly } from "./net";
import { applyOverlay, OverlayItem } from "./overlay";
import { QItem } from "./queue";
import { withProgramme } from "./programme";
import { localDate, newRequestId } from "./util";

/**
 * What the screens call.
 *
 * Reads come from the phone's saved copy whenever it is recent enough, are
 * shown at once from it when it is older (while a fresh answer is fetched),
 * and only wait on the network when nothing is saved. Writes are sent when
 * they can be and kept, in order, when they cannot - and the screen is told
 * either way, in plain words, never with a status code.
 *
 * No failure in here signs anyone out. A rejected token puts up a notice and
 * leaves the person, their saved data and their unsent work exactly where
 * they were.
 */

export { ApiError, friendly };

/** Set by the sync module; lets writes poke it without a circular import. */
export const hooks: {
  onWritten?: () => void;
  onQueued?: () => void;
  /** A promise for the very first refresh, if one is under way - so a screen
   *  that finds nothing saved waits for it rather than asking separately. */
  firstSync?: () => Promise<void> | null;
} = {};
const FIRST_SYNC_PATIENCE_MS = 12_000;

/* ------------------------------------------------------------------ overlay */

type Sent = { method: string; args: Record<string, any>; meta?: Record<string, any>; sentAt: number };
let recentlySent: Sent[] = [];
const SENT_MEMORY_MS = 3 * 60_000;

function overlayItems(user: string, dataAt: number): OverlayItem[] {
  const now = Date.now();
  recentlySent = recentlySent.filter((s) => now - s.sentAt < SENT_MEMORY_MS);
  // Waiting work always applies. Work the server has taken applies only to an
  // answer that was fetched before it was sent - a newer answer already has it.
  const waiting = queue.pending(user).map((i) => ({ method: i.method, args: i.args, meta: i.meta }));
  const sent = recentlySent.filter((s) => dataAt <= s.sentAt).map(({ method, args, meta }) => ({ method, args, meta }));
  return [...sent, ...waiting];
}

/** What a write changes, so those saved answers are fetched again. */
const INVALIDATES: Record<string, string[]> = {
  mark_attendance: ["get_attendance_by_block", "get_my_applicators_by_section"],
  create_store_request: ["get_store_requests", "get_pending_plans_for_section", "get_pending_plans_for_block", "get_home_metrics"],
  record_application: [
    "get_pending_plans_for_section", "get_pending_plans_for_block", "get_sections_with_pending_work",
    "get_sections_with_issued_work", "get_issued_blocks_in_section", "get_home_metrics",
    "get_upcoming_and_overdue", "get_block_progress", "get_operator_activity", "get_issued_request_for_plan",
  ],
  add_applicators: ["get_my_applicators_by_section", "get_attendance_by_block", "get_applicators_for_block", "get_available_employees_for_team"],
  add_applicator: ["get_my_applicators_by_section", "get_attendance_by_block", "get_applicators_for_block", "get_available_employees_for_team"],
  remove_applicator: ["get_my_applicators_by_section", "get_attendance_by_block", "get_applicators_for_block", "get_available_employees_for_team"],
  request_correction: ["get_correctable", "get_my_corrections"],
  assign_block: ["get_my_applicators_by_section", "get_attendance_by_block", "get_applicators_for_block"],
};

/** The day the work was done, so a late sync does not move it. */
function dateFields(method: string, date: string): Record<string, string> {
  if (method === "mark_attendance") return { attendance_date: date };
  if (method === "record_application") return { application_date: date };
  return {};
}

/** Called once the server has taken a write (now, or later from the queue). */
async function afterSent(user: string, method: string, args: Record<string, any>, meta?: Record<string, any>) {
  recentlySent.push({ method, args, meta, sentAt: Date.now() });
  await cache.invalidate(user, INVALIDATES[method]);
  hooks.onWritten?.();
}

/* -------------------------------------------------------------------- reads */

export type Loaded<T> = {
  data: T;
  /** When this answer was fetched. */
  at: number;
  /** Older than we would normally trust - shown because nothing newer could be fetched. */
  stale: boolean;
  fromCache: boolean;
  /** Why a fresh answer could not be had, when it could not. */
  error?: ApiError;
};

export type CallOpts = { force?: boolean };

/**
 * Cache first. A recent saved answer is returned without touching the
 * network; an older one is returned if the network will not oblige; a missing
 * one has to be fetched. Waiting work is laid over whatever is returned.
 */
export async function loadCached<T = any>(method: string, args?: object, opts: CallOpts = {}): Promise<Loaded<T>> {
  const user = currentUser();
  const full = withProgramme(args) as Record<string, any>;
  let entry = user ? await cache.get<T>(user, method, full) : null;

  // First launch on this phone: one refresh is already fetching everything
  // the screens need. Give it a moment instead of asking for the same things
  // one at a time alongside it.
  if (!entry && user && hooks.firstSync) {
    const first = hooks.firstSync();
    if (first) {
      await Promise.race([first.catch(() => {}), new Promise((r) => setTimeout(r, FIRST_SYNC_PATIENCE_MS))]);
      entry = await cache.get<T>(user, method, full);
    }
  }

  if (entry && !opts.force && cache.isFresh(entry, method)) {
    return { data: shape(user, method, full, entry.v, entry.at), at: entry.at, stale: false, fromCache: true };
  }

  try {
    const fresh = await net.request<T>(method, full);
    const at = Date.now();
    if (user) await cache.set(user, method, full, fresh);
    markAuth(false);
    return { data: shape(user, method, full, fresh, at), at, stale: false, fromCache: false };
  } catch (e) {
    const err = e as ApiError;
    handleKind(err);
    if (entry) {
      debug.info(method, `served from saved copy (${err.kind})`);
      return { data: shape(user, method, full, entry.v, entry.at), at: entry.at, stale: true, fromCache: true, error: err };
    }
    throw withFriendly(err);
  }
}

function shape<T>(user: string | null, method: string, args: Record<string, any>, data: T, at: number): T {
  if (!user) return data;
  return applyOverlay(method, args, data, overlayItems(user, at)) as T;
}

/** The saved answer, if one is already in memory - for first paint. */
export function peekCached<T = any>(method: string, args?: object): { data: T; at: number } | null {
  const user = currentUser();
  if (!user) return null;
  const full = withProgramme(args) as Record<string, any>;
  const e = cache.peek<T>(user, method, full);
  return e ? { data: shape(user, method, full, e.v, e.at), at: e.at } : null;
}

export async function call<T = any>(method: string, args?: object, opts?: CallOpts): Promise<T> {
  return (await loadCached<T>(method, args, opts)).data;
}

function markAuth(expired: boolean) { setAuthExpired(expired); }
function handleKind(err: ApiError) { if (err.kind === "auth") markAuth(true); }
function withFriendly(err: ApiError): ApiError {
  const out = new ApiError(friendly(err), err.kind, { status: err.status, retryAfterMs: err.retryAfterMs, missingMethod: err.missingMethod });
  return out;
}

/* ------------------------------------------------------------------- writes */

export type WriteOpts = {
  /** What a list needs to show this write before the server has it. */
  meta?: Record<string, any>;
};

/** An outcome that means the work is already done, so a repeat is not a failure. */
const ALREADY_DONE = /has already been recorded|already_requested/i;

/**
 * Send a change. Delivered now if the server can be reached; otherwise kept
 * and sent later (the error carries `queued = true`, and the screen should
 * treat that as saved, not failed). Either way it goes out under one request
 * id, so a repeat can never do the work twice.
 */
export async function writeCall<T = any>(method: string, args?: object, opts: WriteOpts = {}): Promise<T> {
  const user = currentUser();
  if (!user) throw new ApiError("You are not signed in.", "auth");
  await queue.load(user);       // the saved queue, before deciding whether anything is ahead of this
  const id = newRequestId();
  const date = localDate();
  const full = { ...(withProgramme(args) as Record<string, any>), ...dateFields(method, date) };

  const save = async (err: ApiError): Promise<never> => {
    await queue.enqueue(user, method, full, { id, meta: { ...opts.meta, date }, date });
    hooks.onQueued?.();
    const out = withFriendly(err);
    out.message = err.kind === "auth" ? friendly(err) : friendly(err, { saved: true });
    out.queued = true;
    throw out;
  };

  // Behind other waiting work, or while the server has asked us to wait:
  // keep the order and do not make a busy server busier.
  if (queue.pending(user).length > 0 || net.cooldownMs() > 0) {
    return save(new ApiError("Waiting its turn.", net.cooldownMs() > 0 ? "cooldown" : "network", { retryAfterMs: net.cooldownMs() }));
  }

  try {
    const data = await net.request<T>(method, { ...full, client_request_id: id }, { write: true });
    markAuth(false);
    await afterSent(user, method, full, opts.meta);
    return data;
  } catch (e) {
    const err = e as ApiError;
    handleKind(err);
    if (err.transient || err.kind === "auth") return save(err);
    throw withFriendly(err);
  }
}

/** Deliver one waiting item. Used by the sync module's flush. */
export async function sendQueued(item: QItem): Promise<unknown> {
  try {
    const data = await net.request(item.method, { ...item.args, client_request_id: item.id }, { write: true, ignoreCooldown: false });
    markAuth(false);
    await afterSent(item.user, item.method, item.args, item.meta);
    return data;
  } catch (e) {
    const err = e as ApiError;
    handleKind(err);
    if (err.kind === "rejected" && ALREADY_DONE.test(err.message)) {
      await afterSent(item.user, item.method, item.args, item.meta);
      return null;   // the work is already on the server - that is the outcome we wanted
    }
    throw err;
  }
}

export async function getQueue(): Promise<QItem[]> {
  const user = currentUser();
  await queue.load(user ?? undefined);
  return user ? queue.pending(user) : [];
}

/* -------------------------------------------------------------------- login */

export async function login(usr: string, pwd: string) {
  try {
    const s = await net.request<{ api_key: string; api_secret: string; user: string; full_name: string }>(
      "mobile_login", { usr, pwd }, { login: true });
    await saveSession(s);
    await queue.load(s.user);     // adopt anything left unsent by an older version
    markAuth(false);
    return s;
  } catch (e) {
    const err = e as ApiError;
    // This call has no session yet, so an auth failure is simply the wrong
    // email or password - not "your session expired".
    if (err.kind === "auth") throw new ApiError("Email or password is invalid. Please try again.", "auth");
    if (err.kind === "throttled" || err.kind === "cooldown") {
      const s = Math.max(1, Math.round((err.retryAfterMs ?? net.cooldownMs("login")) / 1000));
      throw new ApiError(
        `Too many sign-in attempts. Please wait ${s < 90 ? s + " seconds" : Math.round(s / 60) + " minutes"} and try again.`,
        err.kind, { retryAfterMs: err.retryAfterMs });
    }
    throw withFriendly(err);
  }
}

export function sessionUser(): string | null { return currentSession()?.user ?? null; }
