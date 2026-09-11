import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_PREFIX, BASE_URL } from "./config";
import { clearSession, currentSession, loadSession, saveSession } from "./auth";

const QUEUE_KEY = "uc_offline_queue";
const CACHE_PREFIX = "uc_cache_";

export type ApiError = Error & { isNetworkError?: boolean; isAuthError?: boolean; queued?: boolean };

function err(message: string, extra: Partial<ApiError> = {}): ApiError {
  return Object.assign(new Error(message), extra);
}

/** Frappe hides the useful text inside _server_messages; dig it out. */
function extractServerMessage(data: any): string | null {
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

/**
 * One round-trip to the server. Throws with isNetworkError set only when the
 * request never reached the server at all - that is the one case the caller
 * may queue or serve from cache. A real server-side error (permission,
 * validation, bad session) is surfaced as-is.
 */
export async function rawCall<T = any>(method: string, args?: object): Promise<T> {
  const session = currentSession() ?? (await loadSession());

  let res: Response;
  try {
    res = await fetch(BASE_URL + API_PREFIX + method, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session
          ? { Authorization: `token ${session.api_key}:${session.api_secret}` }
          : {}),
      },
      body: JSON.stringify(args ?? {}),
    });
  } catch {
    throw err("No connection to the server.", { isNetworkError: true });
  }

  if (res.status === 401 || res.status === 403) {
    await clearSession();
    throw err("Your session is no longer valid. Please log in again.", {
      isAuthError: true,
    });
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw err(
      res.status === 200
        ? "Unexpected response from the server."
        : `Server error (HTTP ${res.status}).`
    );
  }

  if (!res.ok || data?.exc) {
    throw err(extractServerMessage(data) ?? `Server error (HTTP ${res.status}).`);
  }
  return data.message as T;
}

/** A read. Caches on success; falls back to that cache only when offline. */
export async function call<T = any>(method: string, args?: object): Promise<T> {
  try {
    const message = await rawCall<T>(method, args);
    await AsyncStorage.setItem(
      CACHE_PREFIX + method,
      JSON.stringify({ args: args ?? {}, message })
    );
    return message;
  } catch (e) {
    const e2 = e as ApiError;
    if (e2.isNetworkError) {
      const cached = await AsyncStorage.getItem(CACHE_PREFIX + method);
      if (cached) {
        const c = JSON.parse(cached);
        if (JSON.stringify(c.args) === JSON.stringify(args ?? {})) {
          return c.message as T;
        }
      }
    }
    throw e;
  }
}

/** A write. Queues for later sync only when the request never left the phone. */
export async function writeCall<T = any>(method: string, args?: object): Promise<T> {
  try {
    return await rawCall<T>(method, args);
  } catch (e) {
    const e2 = e as ApiError;
    if (!e2.isNetworkError) throw e;
    const q = await getQueue();
    q.push({ method, args: args ?? {}, ts: Date.now() });
    await setQueue(q);
    throw err("No connection - saved, will send automatically.", { queued: true });
  }
}

type QueueItem = { method: string; args: object; ts: number };

export async function getQueue(): Promise<QueueItem[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? (JSON.parse(raw) as QueueItem[]) : [];
}

async function setQueue(q: QueueItem[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

/** Retries queued writes in order. Returns how many finally went through. */
export async function flushQueue(): Promise<number> {
  const q = await getQueue();
  if (!q.length) return 0;
  const remaining: QueueItem[] = [];
  let synced = 0;
  for (const item of q) {
    try {
      await rawCall(item.method, item.args);
      synced++;
    } catch {
      remaining.push(item);
    }
  }
  await setQueue(remaining);
  return synced;
}

export async function login(usr: string, pwd: string) {
  // allow_guest - this is the one call made without a token.
  const s = await rawCall<{
    api_key: string;
    api_secret: string;
    user: string;
    full_name: string;
  }>("mobile_login", { usr, pwd }).catch((e: ApiError) => {
    // A 401 on *this* call is not an expired session - there is no session
    // yet. It is the credentials just typed, so say that instead of the
    // generic "log in again", which is meaningless on the login screen.
    // Network and genuine server errors keep their own wording.
    if (e.isAuthError)
      throw err("Email or password is invalid. Please try again.", { isAuthError: true });
    throw e;
  });
  await saveSession(s);
  return s;
}
