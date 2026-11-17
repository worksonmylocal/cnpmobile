import { useEffect, useState } from "react";
import { isAuthExpired, subscribeAuth } from "./core";
import { engine } from "./sync";
import type { SyncState } from "./syncEngine";

/** What the sync engine is doing, as React state. */
export function useSyncState(): SyncState {
  const [s, setS] = useState<SyncState>(engine.state);
  useEffect(() => {
    setS(engine.state);
    return engine.subscribe(setS);
  }, []);
  return s;
}

/** Whether the server has rejected the saved sign-in. */
export function useAuthExpired(): boolean {
  const [v, setV] = useState(isAuthExpired());
  useEffect(() => {
    setV(isAuthExpired());
    return subscribeAuth(setV);
  }, []);
  return v;
}
