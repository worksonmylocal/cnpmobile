import { useCallback, useEffect, useRef, useState } from "react";
import { loadCached, peekCached } from "./api";
import { cache, currentUser } from "./core";
import { friendly } from "./net";
import { withProgramme } from "./programme";

/**
 * The load-then-render-or-show-the-error shape every field-page screen uses,
 * now built on the phone's saved copy.
 *
 * What was saved last time shows immediately - no spinner for something we
 * already know - while a fresh answer is fetched only if the saved one has
 * grown old. With no signal the saved answer simply stays on screen, marked
 * with how old it is. A spinner appears only when there is nothing saved at
 * all, and an error only when there is nothing to show instead.
 *
 * When something else updates the saved answer (a sync, a write), the screen
 * picks it up by itself.
 */
export function useLoad<T>(method: string, args?: object, deps: unknown[] = []) {
  const first = peekCached<T>(method, args);
  const [data, setData] = useState<T | null>(first?.data ?? null);
  const [at, setAt] = useState<number | null>(first?.at ?? null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!first);
  const [refreshing, setRefreshing] = useState(false);
  const have = useRef(!!first);

  const key = JSON.stringify(args ?? {});
  const reload = useCallback(async (force = false) => {
    if (have.current) setRefreshing(true); else setLoading(true);
    try {
      const r = await loadCached<T>(method, args, { force });
      have.current = true;
      setData(r.data); setAt(r.at); setStale(r.stale); setError(null);
    } catch (e) {
      // Only an empty screen needs to say so; one with data keeps its data.
      if (!have.current) setError(friendly(e) || "Could not load. Please refresh.");
    } finally {
      setLoading(false); setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, key, ...deps]);

  useEffect(() => { reload(false); }, [reload]);

  // Pick up changes made elsewhere to this screen's saved answer.
  useEffect(() => {
    const user = currentUser();
    if (!user) return;
    const mine = cache.key(user, method, withProgramme(args));
    return cache.subscribe((keys) => { if (!keys.length || keys.includes(mine)) reload(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, key, reload]);

  return { data, error, loading, refreshing, stale, at, reload };
}
