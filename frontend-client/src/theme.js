// Design tokens labConnect — version turquoise médicale (Glovo-style),
// portés depuis le design Anthropic labConnect.html. Toutes les couleurs
// sont précalculées en hex parce que React Native ne supporte pas
// `color-mix()` ni les CSS variables.

// ── Palette principale ────────────────────────────────────────────────
export const C = {
  // Brand turquoise médical
  brand:      "#08C4B2",
  brandDeep:  "#067F73",   // ≈ color-mix(brand 74%, #06322f)
  brandSoft:  "#D9F5F1",   // ≈ color-mix(brand 14%, #fff)
  brandTint:  "#E7F7F4",   // ≈ color-mix(brand 8%, #fff)

  // Background page (menthe doux)
  bg:         "#EAF8F6",
  bgElev:     "#F4FAF9",
  surface:    "#FFFFFF",

  // Encre + neutres
  ink:        "#143942",
  inkSoft:    "#6A828A",
  hair:       "#E4ECEC",
  hairSoft:   "#F0F4F4",

  // Accents (couleurs catégories + statuts)
  coral:      "#FF6B6B",
  coralSoft:  "#FFE4E4",
  sun:        "#FFB938",
  sunSoft:    "#FFF1D6",
  grape:      "#7C6BFF",
  grapeSoft:  "#E8E5FF",
  leaf:       "#21C08A",
  leafSoft:   "#D7F3E7",

  // Compat avec ancien code (sera retiré progressivement)
  o:          "#08C4B2",
  oDeep:      "#067F73",
  oTint:      "#D9F5F1",
  oGlow:      "#E7F7F4",
  ink2:       "#6A828A",
  ink3:       "#8FA3A9",
  line:       "#E4ECEC",
  line2:      "#D0DCDC",
  green:      "#21C08A",
  greenTint:  "#D7F3E7",
  blue:       "#2BB3E3",
  blueTint:   "#D9F0F8",
  rose:       "#FF6B6B",
  roseTint:   "#FFE4E4",
  amber:      "#FFB938",
  amberTint:  "#FFF1D6",
};

// ── Typo ──────────────────────────────────────────────────────────────
// `F.display` (Fredoka) et `F.body` (Nunito) sont undefined au boot →
// fallback système pour ne pas crasher si les polices ne sont pas encore
// chargées. App.js appelle `applyFonts({...})` une fois `useFonts` OK,
// ce qui alimente cet objet en place. Les composants qui lisent ces
// valeurs récupèrent la bonne police au prochain rendu (toutes les
// `StyleSheet.create()` qui passent par `font(...)` re-référencent
// l'objet à chaque appel).
export const F = {
  display:     undefined,   // → "Fredoka_600SemiBold"
  displayBold: undefined,   // → "Fredoka_700Bold"
  body:        undefined,   // → "Nunito_700Bold"
  bodyBold:    undefined,   // → "Nunito_800ExtraBold"
  mono:        undefined,
};

export function applyFonts(map) {
  Object.assign(F, map || {});
}

// Helper pour construire un style typo cohérent.
// `kind` : "display" | "displayBold" | "body" | "bodyBold"
export function font(kind, size, color) {
  return {
    fontFamily: F[kind] || F.body || F.display || undefined,
    fontSize: size,
    color,
  };
}

// ── Tokens d'arrondi (rondeur "Doux" du design) ───────────────────────
export const R = {
  xs:  9,
  sm:  13,
  md:  18,
  lg:  24,    // card radius (--r-card)
  xl:  30,
  pill: 999,
};

// ── Ombres (iOS + Android elevation) ──────────────────────────────────
export const SHADOW = {
  sm: {
    shadowColor: "#143942",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  md: {
    shadowColor: "#143942",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 22,
    elevation: 5,
  },
  brand: {
    shadowColor: "#08C4B2",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 6,
  },
};

// ── Format monnaie Mauritanie ─────────────────────────────────────────
export const CURRENCY = {
  code: "MRU",
  symbol: "MRU",
  format(n) {
    return `${Number(n || 0).toLocaleString("fr-FR")} ${this.symbol}`;
  },
};

// ── Géo : centre Nouakchott (point de repli pour les recherches géo) ──
export const DEFAULT_LOCATION = { lat: 18.0735, lng: -15.9582 };

// ── Statuts : couleur + label FR (mappé sur les statuts backend) ──────
export const STATUS_STYLE = {
  pending:     { color: C.sun,    bg: "rgba(255,185,56,0.16)",  label: "En attente" },
  confirmed:   { color: C.brand,  bg: "rgba(8,196,178,0.14)",   label: "Confirmé" },
  checked_in:  { color: C.grape,  bg: "rgba(124,107,255,0.14)", label: "Enregistré" },
  in_progress: { color: C.grape,  bg: "rgba(124,107,255,0.14)", label: "En cours" },
  completed:   { color: C.leaf,   bg: "rgba(33,192,138,0.14)",  label: "Terminé" },
  cancelled:   { color: C.coral,  bg: "rgba(255,107,107,0.14)", label: "Annulé" },
  no_show:     { color: "#9AA7AC", bg: "rgba(154,167,172,0.16)", label: "Absence" },
};

// ── Couleurs par catégorie d'échantillon ──────────────────────────────
// Mappé sur les categories backend (sample_type) pour rester cohérent
// avec le catalogue.
export const CATEGORY_COLOR = {
  blood:  C.coral,
  urine:  C.sun,
  stool:  C.leaf,
  saliva: C.brand,
  swab:   C.grape,
  other:  C.grape,
};

// Couleur de label par labo (déterministe sur UUID) — utilisée pour
// teinter le logo carré de chaque carte labo dans la liste.
const LAB_COLORS = [C.brand, C.grape, C.coral, C.sun, C.leaf];
export function labColor(uuid) {
  const s = String(uuid || "");
  const sum = [...s].reduce((a, c) => a + c.charCodeAt(0), 0);
  return LAB_COLORS[sum % LAB_COLORS.length];
}

// Icône médicale par labo (déterministe sur UUID) — varie l'icône pour
// que la liste de labs n'ait pas l'air monotone.
const LAB_ICONS = ["flask", "vial", "droplet", "microscope", "stethoscope", "dna", "pill"];
export function labIcon(uuid) {
  const s = String(uuid || "");
  const sum = [...s].reduce((a, c) => a + c.charCodeAt(0), 0);
  return LAB_ICONS[sum % LAB_ICONS.length];
}
