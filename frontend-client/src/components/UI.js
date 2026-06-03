// Composants partagés labConnect (turquoise médical).
// Icônes : composant <Icon name="..."/> au-dessus de Feather / MCI.
// Typo : Fredoka pour display, Nunito pour body, via theme.F.
import React from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Pressable,
  ActivityIndicator,
} from "react-native";
import { C, R, SHADOW, STATUS_STYLE, F } from "../theme";
import { Icon } from "../icons";

// ── Pill button (Btn) ──────────────────────────────────────────────────
// Variants : primary, dark, soft, ghost, coral.
// `icon` / `iconR` acceptent SOIT une string nom d'icône, SOIT un noeud
// React déjà rendu — pratique pour des cas exotiques (lettre "G" Google,
// bouton compteur custom, etc.).
export function Btn({
  children, onPress, variant = "primary", size = "lg", full,
  icon, iconR, loading, disabled, style,
}) {
  const sz = SIZES[size];
  const vr = VARIANTS[variant];
  const dis = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={dis}
      style={({ pressed }) => [
        styles.btnBase, sz, vr,
        full && { alignSelf: "stretch" },
        pressed && !dis && { transform: [{ scale: 0.97 }] },
        dis && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={vr.color} size="small" />
      ) : (
        <>
          {renderIconSlot(icon, sz.fontSize + 4, vr.color)}
          <Text style={[
            styles.btnLabel,
            { color: vr.color, fontSize: sz.fontSize, fontFamily: F.displayBold || F.display },
          ]}>
            {children}
          </Text>
          {renderIconSlot(iconR, sz.fontSize + 4, vr.color)}
        </>
      )}
    </Pressable>
  );
}

function renderIconSlot(slot, size, color) {
  if (!slot) return null;
  if (typeof slot === "string") {
    // Heuristique : si la string ne contient pas de tiret/camel ressemblant
    // à un nom d'icône (ex: "G" pour Google), on l'affiche en texte.
    if (/^[A-Z]$/.test(slot)) {
      return <Text style={{ color, fontWeight: "800", fontSize: size, fontFamily: F.displayBold || F.display }}>{slot}</Text>;
    }
    return <Icon name={slot} size={size} color={color} />;
  }
  return slot;
}

const SIZES = {
  lg: { paddingVertical: 16, paddingHorizontal: 24, fontSize: 16 },
  md: { paddingVertical: 12, paddingHorizontal: 20, fontSize: 15 },
  sm: { paddingVertical: 9,  paddingHorizontal: 16, fontSize: 13.5 },
};

const VARIANTS = {
  primary: { backgroundColor: C.brand,     color: "#fff",       ...SHADOW.brand },
  dark:    { backgroundColor: C.ink,       color: "#fff",       ...SHADOW.sm },
  soft:    { backgroundColor: C.brandSoft, color: C.brandDeep },
  ghost:   { backgroundColor: "#fff",      color: C.ink,        borderWidth: 1.5, borderColor: C.hair },
  coral:   { backgroundColor: C.coral,     color: "#fff",       ...SHADOW.sm },
};

// ── Round icon button (IconBtn) ────────────────────────────────────────
// Surface ronde avec une icône vectorielle au centre.
export function IconBtn({
  name, onPress, size = 44, glyph = 20,
  bg = "#fff", color = C.ink, shadow = true, style,
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: size, height: size, borderRadius: 999,
          backgroundColor: bg, alignItems: "center", justifyContent: "center",
        },
        shadow && SHADOW.sm,
        pressed && { transform: [{ scale: 0.92 }] },
        style,
      ]}
    >
      <Icon name={name} size={glyph} color={color} />
    </Pressable>
  );
}

// ── Chip (filtres horizontaux) ─────────────────────────────────────────
export function Chip({ children, active, onPress, icon, color = C.brand, style }) {
  const fg = active ? color : C.inkSoft;
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      style={[
        styles.chipBase,
        active
          ? { borderColor: color, backgroundColor: hexA(color, 0.13) }
          : { borderColor: C.hair, backgroundColor: "#fff" },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={15} color={fg} /> : null}
      <Text style={[styles.chipLabel, { color: fg, fontFamily: F.bodyBold || F.body }]}>
        {children}
      </Text>
    </TouchableOpacity>
  );
}

// ── Card ───────────────────────────────────────────────────────────────
export function Card({ children, onPress, pad = 16, style }) {
  const Cmp = onPress ? TouchableOpacity : View;
  const props = onPress ? { onPress, activeOpacity: 0.92 } : null;
  return (
    <Cmp {...props} style={[styles.cardBase, { padding: pad }, style]}>
      {children}
    </Cmp>
  );
}

// ── Status badge ───────────────────────────────────────────────────────
export function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.pending;
  return (
    <View style={[styles.statusBase, { backgroundColor: s.bg }]}>
      <View style={[styles.statusDot, { backgroundColor: s.color }]} />
      <Text style={[styles.statusLabel, { color: s.color, fontFamily: F.bodyBold || F.body }]}>
        {s.label}
      </Text>
    </View>
  );
}

// ── Tag (mini-badge tinté) ─────────────────────────────────────────────
export function Tag({ children, color = C.brand, icon, solid, style }) {
  const bg = solid ? color : hexA(color, 0.14);
  const fg = solid ? "#fff" : color;
  return (
    <View style={[styles.tagBase, { backgroundColor: bg }, style]}>
      {icon ? <Icon name={icon} size={12} color={fg} /> : null}
      <Text style={[styles.tagLabel, { color: fg, fontFamily: F.bodyBold || F.body }]}>
        {children}
      </Text>
    </View>
  );
}

// ── Stars (note + valeur) ──────────────────────────────────────────────
export function Stars({ value, size = 14 }) {
  return (
    <View style={styles.starsBase}>
      <Icon name="star" size={size} color={C.sun} />
      <Text style={{ fontFamily: F.displayBold || F.display, fontWeight: "700", fontSize: size, color: C.ink, marginLeft: 4 }}>
        {Number(value || 0).toFixed(1)}
      </Text>
    </View>
  );
}

// ── Avatar (initiales) ─────────────────────────────────────────────────
export function Avatar({ name, size = 44, color = C.grape }) {
  const initials = (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <View
      style={{
        width: size, height: size, borderRadius: 999,
        backgroundColor: hexA(color, 0.18),
        alignItems: "center", justifyContent: "center",
      }}
    >
      <Text style={{ color, fontSize: size * 0.38, fontWeight: "700", fontFamily: F.displayBold || F.display }}>
        {initials || "?"}
      </Text>
    </View>
  );
}

// ── Section title row ──────────────────────────────────────────────────
export function SectionTitle({ children, action, onAction, style }) {
  return (
    <View style={[styles.sectionRow, style]}>
      <Text style={[styles.sectionTitle, { fontFamily: F.displayBold || F.display }]}>
        {children}
      </Text>
      {action ? (
        <TouchableOpacity onPress={onAction}>
          <Text style={[styles.sectionAction, { fontFamily: F.bodyBold || F.body }]}>
            {action}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ── FloatBack (header bouton retour flottant pour écrans pushed) ───────
export function FloatBack({ onBack, right }) {
  return (
    <View style={styles.floatBackWrap} pointerEvents="box-none">
      <IconBtn name="chevronL" glyph={24} onPress={onBack} />
      {right ?? <View style={{ width: 44 }} />}
    </View>
  );
}

// ── ScreenHeader ───────────────────────────────────────────────────────
export function ScreenHeader({ title, subtitle, onBack, right }) {
  return (
    <View style={styles.screenHeader}>
      {onBack ? (
        <IconBtn name="chevronL" glyph={24} bg={C.bg} shadow={false} onPress={onBack} />
      ) : (
        <View style={{ width: 44 }} />
      )}
      <View style={{ flex: 1, marginHorizontal: 12 }}>
        <Text style={[styles.screenHeaderTitle, { fontFamily: F.displayBold || F.display }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.screenHeaderSub, { fontFamily: F.bodyBold || F.body }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ?? <View style={{ width: 44 }} />}
    </View>
  );
}

// ── Divider ────────────────────────────────────────────────────────────
export function Divider({ dashed, style }) {
  return (
    <View
      style={[
        { height: dashed ? 0 : 1, backgroundColor: C.hair },
        dashed && {
          borderTopWidth: 1.5,
          borderTopColor: C.hair,
          borderStyle: "dashed",
        },
        style,
      ]}
    />
  );
}

// ── Helpers ────────────────────────────────────────────────────────────
export function hexA(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ── Styles ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  btnBase: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    borderRadius: 999, gap: 8,
  },
  btnLabel: { fontWeight: "700", letterSpacing: 0.2 },

  chipBase: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 8, paddingHorizontal: 15,
    borderRadius: 999, borderWidth: 1.5,
  },
  chipLabel: { fontWeight: "700", fontSize: 13.5 },

  cardBase: {
    backgroundColor: "#fff", borderRadius: R.lg,
    ...SHADOW.sm,
  },

  statusBase: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 5, paddingHorizontal: 11,
    borderRadius: 999,
  },
  statusDot:   { width: 7, height: 7, borderRadius: 999 },
  statusLabel: { fontSize: 12, fontWeight: "800" },

  tagBase: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingVertical: 4, paddingHorizontal: 10,
    borderRadius: 999,
  },
  tagLabel: { fontWeight: "800", fontSize: 12 },

  starsBase: { flexDirection: "row", alignItems: "center" },

  sectionRow: {
    flexDirection: "row", alignItems: "baseline",
    justifyContent: "space-between", marginBottom: 12,
  },
  sectionTitle:  { fontSize: 19, fontWeight: "700", color: C.ink, letterSpacing: 0.2 },
  sectionAction: { fontSize: 14, fontWeight: "800", color: C.brandDeep },

  floatBackWrap: {
    position: "absolute", top: 58, left: 16, right: 16,
    flexDirection: "row", justifyContent: "space-between",
    zIndex: 20,
  },

  screenHeader: {
    flexDirection: "row", alignItems: "center",
    paddingTop: 14, paddingBottom: 12, paddingHorizontal: 16,
    backgroundColor: "#fff",
  },
  screenHeaderTitle: { fontSize: 19, fontWeight: "700", color: C.ink },
  screenHeaderSub:   { fontSize: 12, fontWeight: "700", color: C.inkSoft, marginTop: 2 },
});
