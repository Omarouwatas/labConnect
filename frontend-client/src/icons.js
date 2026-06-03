// Module d'icônes unifié.
//
// On expose un seul composant `<Icon name="..." />` adossé à
// `@expo/vector-icons`. La map de noms abstrait sciemment la famille
// utilisée derrière (Feather pour les icônes UI génériques, Material
// Community Icons pour les icônes médicales : tube à essai, microscope,
// pipette, etc.). Si on veut changer de famille, un seul fichier à
// toucher.
//
// Conventions :
//   - Tous les noms sont en camelCase et reprennent le vocabulaire du
//     design Anthropic (chevronL, pinFill, sparkle…)
//   - `size` défaut 20, `color` défaut C.ink, `strokeWidth` ignoré pour
//     les familles "filled" (MCI)
//
import React from "react";
import { Feather, MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import { C } from "./theme";

// Map : nom abstrait → { family, glyph }
// "family" est "feather" | "mci" | "ion"
const ICONS = {
  // Navigation / UI
  chevronL:    { family: "feather", glyph: "chevron-left" },
  chevronR:    { family: "feather", glyph: "chevron-right" },
  chevronD:    { family: "feather", glyph: "chevron-down" },
  chevronU:    { family: "feather", glyph: "chevron-up" },
  arrowR:      { family: "feather", glyph: "arrow-right" },
  arrowL:      { family: "feather", glyph: "arrow-left" },
  close:       { family: "feather", glyph: "x" },
  more:        { family: "feather", glyph: "more-horizontal" },
  search:      { family: "feather", glyph: "search" },
  filter:      { family: "feather", glyph: "filter" },
  refresh:     { family: "feather", glyph: "refresh-cw" },

  // Tabs / Profil
  home:        { family: "feather", glyph: "home" },
  homeFill:    { family: "ion",     glyph: "home" },
  calendar:    { family: "feather", glyph: "calendar" },
  calendarFill:{ family: "ion",     glyph: "calendar" },
  user:        { family: "feather", glyph: "user" },
  userFill:    { family: "ion",     glyph: "person" },

  // Actions
  plus:        { family: "feather", glyph: "plus" },
  minus:       { family: "feather", glyph: "minus" },
  check:       { family: "feather", glyph: "check" },
  checkCircle: { family: "feather", glyph: "check-circle" },
  heart:       { family: "feather", glyph: "heart" },
  heartFill:   { family: "ion",     glyph: "heart" },
  star:        { family: "ion",     glyph: "star" },
  starOutline: { family: "ion",     glyph: "star-outline" },
  bell:        { family: "feather", glyph: "bell" },
  lock:        { family: "feather", glyph: "lock" },
  logout:      { family: "feather", glyph: "log-out" },
  edit:        { family: "feather", glyph: "edit-2" },
  trash:       { family: "feather", glyph: "trash-2" },
  info:        { family: "feather", glyph: "info" },
  alert:       { family: "feather", glyph: "alert-circle" },

  // Communication
  phone:       { family: "feather", glyph: "phone" },
  mail:        { family: "feather", glyph: "mail" },
  message:     { family: "feather", glyph: "message-square" },

  // Géo / lieux
  pin:         { family: "feather", glyph: "map-pin" },
  pinFill:     { family: "ion",     glyph: "location" },
  map:         { family: "feather", glyph: "map" },
  nav:         { family: "feather", glyph: "navigation" },
  route:       { family: "mci",     glyph: "routes" },

  // Bâtiments / lieux
  house:       { family: "feather", glyph: "home" },
  house2:      { family: "mci",     glyph: "home-variant-outline" },
  hospital:    { family: "mci",     glyph: "hospital-building" },
  building:    { family: "feather", glyph: "home" },

  // Santé / médical
  shield:      { family: "feather", glyph: "shield" },
  shieldFill:  { family: "ion",     glyph: "shield-checkmark" },
  vial:        { family: "mci",     glyph: "test-tube" },
  flask:       { family: "mci",     glyph: "flask-outline" },
  droplet:     { family: "feather", glyph: "droplet" },
  microscope:  { family: "mci",     glyph: "microscope" },
  syringe:     { family: "mci",     glyph: "needle" },
  pulse:       { family: "feather", glyph: "activity" },
  stethoscope: { family: "mci",     glyph: "stethoscope" },
  dna:         { family: "mci",     glyph: "dna" },
  pill:        { family: "mci",     glyph: "pill" },

  // Time
  clock:       { family: "feather", glyph: "clock" },
  timer:       { family: "ion",     glyph: "timer-outline" },

  // Documents
  document:    { family: "feather", glyph: "file-text" },
  download:    { family: "feather", glyph: "download" },
  print:       { family: "feather", glyph: "printer" },

  // Misc
  sparkle:     { family: "feather", glyph: "zap" },
  google:      { family: "ion",     glyph: "logo-google" },
  fire:        { family: "ion",     glyph: "flame" },
  party:       { family: "mci",     glyph: "party-popper" },
};

/**
 * Composant Icon unifié.
 *
 * Props :
 *   name        — clé dans ICONS (cf. plus haut)
 *   size        — taille en pt (défaut 20)
 *   color       — couleur (défaut C.ink)
 *   style       — style React Native passé au composant icône natif
 */
export function Icon({ name, size = 20, color = C.ink, style }) {
  const entry = ICONS[name];
  if (!entry) {
    if (__DEV__) console.warn(`[Icon] nom inconnu : "${name}"`);
    return null;
  }
  const props = { name: entry.glyph, size, color, style };
  switch (entry.family) {
    case "ion":     return <Ionicons {...props} />;
    case "mci":     return <MaterialCommunityIcons {...props} />;
    case "feather":
    default:        return <Feather {...props} />;
  }
}

// Export pour usage direct si on a besoin d'une autre famille en
// exception.
export { Feather, MaterialCommunityIcons, Ionicons };
