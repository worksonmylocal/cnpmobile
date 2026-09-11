import * as SecureStore from "expo-secure-store";

export type Session = {
  api_key: string;
  api_secret: string;
  user: string;
  full_name: string;
};

const KEY = "cnp_session";

// Kept in memory so every API call doesn't hit the keystore.
let cached: Session | null = null;

export async function loadSession(): Promise<Session | null> {
  if (cached) return cached;
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    cached = JSON.parse(raw) as Session;
  } catch {
    await SecureStore.deleteItemAsync(KEY);
    return null;
  }
  return cached;
}

export async function saveSession(s: Session): Promise<void> {
  cached = s;
  await SecureStore.setItemAsync(KEY, JSON.stringify(s));
}

export async function clearSession(): Promise<void> {
  cached = null;
  await SecureStore.deleteItemAsync(KEY);
}

export function currentSession(): Session | null {
  return cached;
}
