import { useCallback, useEffect, useState } from "react";
import { call } from "./api";

/**
 * The load-then-render-or-show-the-error shape every field-page screen uses:
 * a spinner while in flight, the server's own message on failure.
 */
export function useLoad<T>(method: string, args?: object, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const key = JSON.stringify(args ?? {});
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await call<T>(method, args));
      setError(null);
    } catch (e) {
      setError((e as Error).message || "Could not load. Please refresh.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, key, ...deps]);

  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload };
}
