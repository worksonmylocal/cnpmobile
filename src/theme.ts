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

/**
 * Scales, rather than a number picked per component.
 *
 * Borrowed from the Harvest app's theme so the two Upande field apps are built
 * on the same measurements - someone moving between them should not be able to
 * tell that two people wrote them. The palette stays CNP's own, because that
 * one is transcribed from dashboard.css and keeps this app and the web page
 * looking like one product.
 */
export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const R = { sm: 6, md: 10, lg: 14, xl: 20, full: 9999 } as const;

export const FS = { xs: 11, sm: 13, md: 15, lg: 18, xl: 22, xxl: 28 } as const;

export const TYPE = {
  h1: { fontFamily: F.bold, fontSize: FS.xxl, color: C.ink },
  h2: { fontFamily: F.bold, fontSize: FS.xl, color: C.ink },
  h3: { fontFamily: F.semibold, fontSize: FS.lg, color: C.ink },
  body: { fontFamily: F.regular, fontSize: FS.md, color: C.ink },
  bodySmall: { fontFamily: F.regular, fontSize: FS.sm, color: C.ink4 },
  caption: { fontFamily: F.medium, fontSize: FS.xs, color: C.inkMute },
  label: { fontFamily: F.semibold, fontSize: FS.sm, color: C.ink },
} as const;

/** Two weights of lift. shadowCard above is the heavier card treatment. */
export const SH = {
  sm: {
    shadowColor: "#0a0a0a", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 2, elevation: 1,
  },
  md: {
    shadowColor: "#0a0a0a", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
} as const;

export const APP_TITLE = "UpandeCNP Field";
