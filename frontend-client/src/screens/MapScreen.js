// MapScreen — vue plein écran de la carte des labos.
//
// Layout :
//
//   ┌─────────────────────────────────────────┐
//   │   ← header (absolute, top)              │
//   │                                         │
//   │            ╳ Vous êtes ici              │
//   │                                         │
//   │       ●  ●         ●  (carte LEAFLET    │
//   │           ●               PLEIN ÉCRAN)  │
//   │                                         │
//   │                                         │
//   │   ┌─ callout (absolute, bottom) ──┐     │
//   └─────────────────────────────────────────┘
//
// La carte est placée en `StyleSheet.absoluteFillObject` pour qu'elle
// occupe TOUT l'écran derrière les overlays. Le header et le callout
// sont eux-mêmes en position absolue et utilisent `pointerEvents` pour
// laisser passer les clics carte hors de leur boîte.
//
// Pourquoi pas un simple `<View style={{flex:1}}><LabMapView/></View>`
// avec header en absolute ?  Parce qu'en pratique, la WebView de
// react-native-webview a parfois besoin de dimensions concrètes parmi
// ses ancêtres pour se mesurer (surtout au premier render Android).
// Le `absoluteFillObject` fournit ces dimensions de manière explicite.
import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import LabMapView from "../components/LabMapView";
import { C, R, SHADOW, F, labColor, labIcon } from "../theme";
import { Icon } from "../icons";
import { hexA } from "../components/UI";

export default function MapScreen({ route, navigation }) {
  const labs = route.params?.labs || [];
  const userLoc = route.params?.userLoc || null;
  const [selected, setSelected] = useState(null);

  const goToDetail = (lab) => navigation.navigate("LabDetail", { lab, userLoc });
  const selectedLab = selected ? labs.find((l) => l.uuid === selected) : null;

  return (
    <View style={styles.root}>
      {/* ── Carte : prend les dimensions de window via useWindowDimensions ── */}
      <LabMapView
        labs={labs}
        userLocation={userLoc}
        onLabPress={setSelected}
      />

      {/* ── Header (overlay haut) ─────────────────────────── */}
      <SafeAreaView
        edges={["top"]}
        style={styles.headerSafe}
        pointerEvents="box-none"
      >
        <View style={styles.header} pointerEvents="box-none">
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            activeOpacity={0.85}
          >
            <Icon name="chevronL" size={22} color={C.ink} />
          </TouchableOpacity>
          <View style={styles.headerBadge}>
            <Icon name="pinFill" size={14} color={C.brand} />
            <Text style={styles.headerBadgeText} numberOfLines={1}>
              {labs.length} labos{userLoc ? " · position détectée" : ""}
            </Text>
          </View>
          {userLoc && (
            <View style={styles.youBadge}>
              <View style={styles.youDot} />
              <Text style={styles.youText}>Vous</Text>
            </View>
          )}
        </View>
      </SafeAreaView>

      {/* ── Callout d'un labo sélectionné (overlay bas) ───── */}
      {selectedLab && (
        <SafeAreaView
          edges={["bottom"]}
          style={styles.calloutSafe}
          pointerEvents="box-none"
        >
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => goToDetail(selectedLab)}
            style={styles.callout}
          >
            <View style={[styles.labLogo, { backgroundColor: hexA(labColor(selectedLab.uuid), 0.16) }]}>
              <Icon name={labIcon(selectedLab.uuid)} size={28} color={labColor(selectedLab.uuid)} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.calloutName} numberOfLines={1}>{selectedLab.name}</Text>
              <Text style={styles.calloutSub} numberOfLines={1}>
                {selectedLab.distance_km != null
                  ? `${selectedLab.distance_km.toFixed(1)} km`
                  : (selectedLab.city || "")}
                {selectedLab.address ? ` · ${selectedLab.address}` : ""}
              </Text>
            </View>
            <View style={styles.calloutCta}>
              <Text style={styles.calloutCtaText}>Voir</Text>
              <Icon name="chevronR" size={18} color="#fff" />
            </View>
          </TouchableOpacity>
        </SafeAreaView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Conteneur racine : flex:1 → prend toute la hauteur de la stack nav.
  root: { flex: 1, backgroundColor: C.bg },

  // Overlay header : pinned en haut, sans capturer les clics du fond.
  headerSafe: {
    position: "absolute",
    top: 0, left: 0, right: 0,
  },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  backBtn: {
    width: 42, height: 42, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#fff", ...SHADOW.sm,
  },
  headerBadge: {
    flex: 1,
    flexDirection: "row", alignItems: "center", gap: 7,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: "#fff", borderRadius: 14,
    ...SHADOW.sm,
  },
  headerBadgeText: {
    fontSize: 12.5, fontWeight: "800", color: C.ink,
    fontFamily: F.bodyBold,
  },
  youBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 9,
    backgroundColor: "rgba(74,111,165,0.95)", borderRadius: 14,
    ...SHADOW.sm,
  },
  youDot: { width: 8, height: 8, borderRadius: 999, backgroundColor: "#fff" },
  youText: { fontSize: 12, fontWeight: "800", color: "#fff" },

  // Overlay callout : pinned en bas.
  calloutSafe: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
  },
  callout: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: 14, marginBottom: 10,
    padding: 12, backgroundColor: "#fff",
    borderRadius: 20, ...SHADOW.md,
  },
  labLogo: {
    width: 54, height: 54, borderRadius: 17,
    alignItems: "center", justifyContent: "center",
  },
  calloutName: { fontSize: 15.5, fontWeight: "800", color: C.ink, fontFamily: F.displayBold },
  calloutSub:  { fontSize: 12.5, fontWeight: "700", color: C.inkSoft, marginTop: 2 },
  calloutCta: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: C.brand, borderRadius: 14,
  },
  calloutCtaText: { fontSize: 13, fontWeight: "800", color: "#fff" },
});
