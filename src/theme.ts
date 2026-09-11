/**
 * The field page's design system, transcribed from
 * upandecnp/public/css/dashboard.css (:root) so the app and the web page
 * stay one product. Keep these in step with that file.
 */
export const C = {
  // Shades of black - from the Upande logo
  ink: "#0a0a0a",
  ink1: "#1a1a18",
  ink2: "#2a2a26",
  ink3: "#3a3a34",
  ink4: "#5a5a52",
  inkMute: "#8a8780",
  inkFaint: "#b8b6ae",

  // Surfaces
  bg: "#f4f3ef",
  surface: "#fafaf6",
  surface2: "#ffffff",
  hairline: "rgba(10,10,10,0.06)",

  // Single data accent - used sparingly
  signal: "#228883",

  // Semantic status
  good: "#1a8a3a", goodBg: "rgba(26,138,58,0.10)",
  bad: "#c4302b", badBg: "rgba(196,48,43,0.10)",
  warn: "#b9770e", warnBg: "rgba(185,119,14,0.10)",
  info: "#2c6bb3", infoBg: "rgba(44,107,179,0.10)",

  // --grad-ink is a 135deg gradient; RN needs a library for that, so flat
  // ink stands in for it on buttons and chips.
  gradInk: "#0a0a0a",
  onInk: "#fafaf6",

  grey: "rgba(10,10,10,0.06)",
  track: "rgba(10,10,10,0.05)",
} as const;

/** Poppins weights, matching the web page's 400/500/600/700 import. */
export const F = {
  regular: "Poppins_400Regular",
  medium: "Poppins_500Medium",
  semibold: "Poppins_600SemiBold",
  bold: "Poppins_700Bold",
} as const;

/** --shadow-card, translated to RN's shadow model. */
export const shadowCard = {
  shadowColor: "#0a0a0a",
  shadowOpacity: 0.1,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 8 },
  elevation: 2,
} as const;

export const APP_TITLE = "UpandeCNP Field";
