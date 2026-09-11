// The app talks to the live platform - that is where the real CNP data lives.
// Override with EXPO_PUBLIC_CNP_URL in .env to point at a local bench instead.
export const BASE_URL =
  process.env.EXPO_PUBLIC_CNP_URL ?? "https://kaitet-group.upande.com";

// Every field-app endpoint lives in this one whitelisted module.
export const API_PREFIX = "/api/method/upandecnp.upandecnp.api.";
