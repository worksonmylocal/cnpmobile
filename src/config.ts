// Where a fresh install points. Overridable at build time with
// EXPO_PUBLIC_CNP_URL, and at runtime per device - see instance.ts, which is
// what the app actually reads.
export const DEFAULT_BASE_URL =
  process.env.EXPO_PUBLIC_CNP_URL ?? "https://kaitet-group.upande.com";

// Every field-app endpoint lives in this one whitelisted module.
export const API_PREFIX = "/api/method/upandecnp.upandecnp.api.";
