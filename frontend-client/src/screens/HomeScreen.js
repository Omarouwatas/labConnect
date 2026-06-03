// HomeScreen — version turquoise médicale Glovo-style.
// Header avec salutation + lieu + cloche, search, mini-carte cliquable,
// bannière CNAM, chips filtres, liste de labs en cards.
//
// Garde le contrat backend : fetchLabsNearby OU fetchLabs en fallback,
// cancellation via aliveRef pour éviter setState après unmount.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import * as api from "../api";
import { useAuth } from "../auth";
import { C, R, SHADOW, F, DEFAULT_LOCATION, labColor, labIcon } from "../theme";
import { Chip, Card, Tag, Stars, IconBtn, SectionTitle, hexA } from "../components/UI";
import { Icon } from "../icons";
import LabMapView from "../components/LabMapView";

const FILTERS = [
  { id: "all",      label: "Tous",       icon: "sparkle" },
  { id: "open",     label: "Ouvert",     icon: "clock" },
  { id: "domicile", label: "À domicile", icon: "house2" },
  { id: "cnam",     label: "CNAM",       icon: "shield" },
];

export default function HomeScreen({ navigation }) {
  const { user } = useAuth();
  const [labs, setLabs] = useState([]);
  const [loc, setLoc] = useState(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState(null);
  const aliveRef = useRef(true);

  useEffect(() => () => { aliveRef.current = false; }, []);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Géoloc best-effort
      let here = null;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        }
      } catch { /* fallback Nouakchott */ }
      if (!here) here = DEFAULT_LOCATION;
      if (aliveRef.current) setLoc(here);

      // Labos à proximité (fallback complet si l'endpoint nearby échoue)
      let arr = [];
      try {
        arr = await api.fetchLabsNearby(here.lat, here.lng, 20);
      } catch {
        try { arr = await api.fetchLabs(); } catch { arr = []; }
      }
      if (aliveRef.current) setLabs(arr);
    } finally {
      if (aliveRef.current) { setLoading(false); setRefreshing(false); }
    }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return labs.filter((l) => {
      if (filter === "open" && !(l.is_open ?? true)) return false;
      if (filter === "domicile" && !l.accepts_home_visits) return false;
      if (filter === "cnam" && !l.accepts_cnam) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        if (!`${l.name} ${l.city || ""} ${l.address || ""}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [labs, filter, query]);

  const firstName = user?.first_name || "vous";
  const onPickLab = (lab) => navigation.navigate("LabDetail", { lab });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <FlatList
        data={loading ? [] : filtered}
        keyExtractor={(l) => l.uuid}
        contentContainerStyle={{ paddingBottom: 30 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(true); }}
            tintColor={C.brand}
          />
        }
        ListHeaderComponent={
          <>
            <SafeAreaView edges={["top"]}>
              <View style={styles.header}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.hello}>Bonjour, {firstName}</Text>
                  <View style={styles.locRow}>
                    <Icon name="pinFill" size={18} color={C.brand} />
                    <Text style={styles.locText}>
                      {user?.city || "Nouakchott"}
                    </Text>
                    <Icon name="chevronD" size={16} color={C.inkSoft} />
                  </View>
                </View>
                <View>
                  <IconBtn name="bell" glyph={20} onPress={() => {}} />
                  <View style={styles.notifDot} />
                </View>
              </View>

              {/* Search */}
              <View style={styles.searchBox}>
                <Icon name="search" size={20} color={C.inkSoft} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Rechercher un labo ou une analyse…"
                  placeholderTextColor={C.inkSoft}
                  style={styles.searchInput}
                  returnKeyType="search"
                />
              </View>
            </SafeAreaView>

            {/* Mini map */}
            <View style={styles.mapCard}>
              <LabMapView
                labs={(filtered.length ? filtered : labs).slice(0, 20)}
                userLocation={loc}
                onLabPress={(uuid) => setSelected(uuid)}
                height={200}
              />
              <View style={styles.mapBadge}>
                <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: C.leaf }} />
                <Text style={styles.mapBadgeText}>
                  {labs.length} labos à proximité
                </Text>
              </View>
              {selected ? (() => {
                const l = labs.find((x) => x.uuid === selected);
                if (!l) return null;
                return (
                  <TouchableOpacity
                    activeOpacity={0.9}
                    onPress={() => onPickLab(l)}
                    style={styles.mapCallout}
                  >
                    <View style={[styles.labLogo, { backgroundColor: hexA(labColor(l.uuid), 0.16) }]}>
                      <Icon name={labIcon(l.uuid)} size={26} color={labColor(l.uuid)} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.calloutName}>{l.name}</Text>
                      <Text style={styles.calloutSub}>
                        {l.distance_km ? `${l.distance_km.toFixed(1)} km` : ""}
                        {l.eta_min ? ` · ${l.eta_min} min` : ""}
                      </Text>
                    </View>
                    <Icon name="chevronR" size={22} color={C.brand} />
                  </TouchableOpacity>
                );
              })() : null}
            </View>

            {/* CNAM banner */}
            <View style={styles.cnamBanner}>
              <View style={styles.cnamIcon}>
                <Icon name="shieldFill" size={24} color={C.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cnamTitle}>Prise en charge CNAM</Text>
                <Text style={styles.cnamSub}>Jusqu'à 80% remboursé sur vos analyses</Text>
              </View>
            </View>

            {/* Filters */}
            <View style={styles.filtersWrap}>
              <FlatList
                horizontal
                data={FILTERS}
                keyExtractor={(f) => f.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
                renderItem={({ item }) => (
                  <Chip
                    active={filter === item.id}
                    onPress={() => setFilter(item.id)}
                    icon={item.icon}
                  >
                    {item.label}
                  </Chip>
                )}
              />
            </View>

            {/* Section title */}
            <View style={{ paddingHorizontal: 20, marginTop: 18 }}>
              <SectionTitle>Labos près de vous</SectionTitle>
            </View>
          </>
        }
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
            <LabCard lab={item} onPress={() => onPickLab(item)} selected={item.uuid === selected} />
          </View>
        )}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={C.brand} style={{ marginTop: 30 }} />
          ) : (
            <Text style={styles.empty}>
              Aucun labo ne correspond à vos filtres.
            </Text>
          )
        }
      />
    </View>
  );
}

// ── LabCard ─────────────────────────────────────────────────────────────
function LabCard({ lab, onPress, selected }) {
  const color = labColor(lab.uuid);
  const isOpen = lab.is_open ?? true;
  const distance = lab.distance_km
    ? `${lab.distance_km.toFixed(1)} km`
    : (lab.city || "Nouakchott");
  const eta = lab.eta_min ? `${lab.eta_min} min` : null;
  return (
    <Card
      onPress={onPress}
      pad={14}
      style={[
        { flexDirection: "row", alignItems: "center", gap: 13 },
        selected && { borderWidth: 2, borderColor: C.brand },
      ]}
    >
      <View style={[styles.labLogo, { backgroundColor: hexA(color, 0.16) }]}>
        <Icon name={labIcon(lab.uuid)} size={30} color={color} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text numberOfLines={1} style={styles.labName}>{lab.name}</Text>
          {lab.rating ? <Stars value={lab.rating} /> : null}
        </View>
        <Text style={styles.labMeta}>
          {lab.address ? `${distance} · ${lab.address}` : distance}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          <Tag color={isOpen ? C.leaf : "#9AA7AC"} icon="clock">
            {isOpen ? (eta ? `Ouvert · ${eta}` : "Ouvert") : "Fermé"}
          </Tag>
          {lab.accepts_cnam && <Tag color={C.brand} icon="shield">CNAM</Tag>}
          {lab.accepts_home_visits && <Tag color={C.grape} icon="house2">Domicile</Tag>}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 20,
    paddingTop: 6, paddingBottom: 14,
  },
  hello:   { fontSize: 13.5, fontWeight: "700", color: C.inkSoft, fontFamily: F.body },
  locRow:  { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
  locText: { fontSize: 18, fontWeight: "700", color: C.ink, fontFamily: F.displayBold },
  notifDot: {
    position: "absolute", top: 8, right: 9,
    width: 9, height: 9, borderRadius: 999,
    backgroundColor: C.coral, borderWidth: 2, borderColor: "#fff",
  },

  searchBox: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#fff", borderRadius: 16,
    paddingHorizontal: 16, paddingVertical: 11,
    marginHorizontal: 20, ...SHADOW.sm,
  },
  searchInput: { flex: 1, fontSize: 14.5, color: C.ink, fontWeight: "600" },

  mapCard: {
    marginHorizontal: 20, marginTop: 12,
    borderRadius: R.lg, overflow: "hidden", ...SHADOW.md,
    backgroundColor: "#E8F1F0",
  },
  mapBadge: {
    position: "absolute", top: 12, left: 12,
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
  },
  mapBadgeText: { fontSize: 12.5, fontWeight: "800", color: C.ink, fontFamily: F.bodyBold },
  mapCallout: {
    position: "absolute", bottom: 12, left: 12, right: 12,
    flexDirection: "row", alignItems: "center", gap: 11,
    backgroundColor: "#fff", borderRadius: 18, padding: 10,
    ...SHADOW.md,
  },
  calloutName: { fontSize: 15, fontWeight: "700", color: C.ink, fontFamily: F.displayBold },
  calloutSub:  { fontSize: 12, fontWeight: "700", color: C.inkSoft, marginTop: 2, fontFamily: F.body },

  cnamBanner: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: 20, marginTop: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: hexA(C.brand, 0.10), borderRadius: R.lg,
  },
  cnamIcon: {
    width: 42, height: 42, borderRadius: 14, backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center",
  },
  cnamTitle: { fontSize: 15, fontWeight: "700", color: C.ink, fontFamily: F.displayBold },
  cnamSub:   { fontSize: 12.5, fontWeight: "700", color: C.inkSoft, marginTop: 1, fontFamily: F.body },

  filtersWrap: { marginTop: 18 },

  labLogo: {
    width: 58, height: 58, borderRadius: 18,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  labName: { fontSize: 16.5, fontWeight: "700", color: C.ink, flexShrink: 1, fontFamily: F.displayBold },
  labMeta: { fontSize: 13, fontWeight: "600", color: C.inkSoft, marginTop: 2, fontFamily: F.body },

  empty: { textAlign: "center", color: C.inkSoft, padding: 30, fontWeight: "600" },
});
