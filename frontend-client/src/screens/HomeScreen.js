// HomeScreen — recherche unifiée labos + analyses, mini-carte agrandie
// avec position exacte, filtres distance/catégorie/CNAM/domicile.
//
// La recherche fonctionne sur deux axes simultanés :
//   1. Nom de labo + ville/adresse
//   2. Code ou nom d'analyse (NFS, glycémie, etc.) — pour ça on charge les
//      catalogues à la demande la 1ʳᵉ fois qu'une requête non vide est tapée,
//      puis on les met en cache pour le reste de la session.
//
// Pour chaque labo, on affiche le nombre d'analyses qui matchent la requête,
// la distance, l'icône lab et un état ouvert/fermé.
//
// La mini-carte (260px) montre la position exacte du patient (halo bleu
// pulsant) + les labos à proximité. Tap sur la carte → MapScreen plein écran.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import * as api from "../api";
import { useAuth } from "../auth";
import { C, R, SHADOW, F, DEFAULT_LOCATION, labColor, labIcon } from "../theme";
import { Chip, Card, Tag, Stars, IconBtn, SectionTitle, hexA } from "../components/UI";
import { Icon } from "../icons";
import LabMapView from "../components/LabMapView";
import NotificationsBell from "../components/NotificationsBell";

// ── Filtres ─────────────────────────────────────────────────────────────
const FILTERS = [
  { id: "all",      label: "Tous",        icon: "sparkle" },
  { id: "near",     label: "Près de moi", icon: "pinFill" },
  { id: "open",     label: "Ouvert",      icon: "clock" },
  { id: "domicile", label: "À domicile",  icon: "house2" },
  { id: "cnam",     label: "CNAM",        icon: "shield" },
];

const CATEGORIES = [
  { id: "all",    label: "Toutes", icon: "flask" },
  { id: "blood",  label: "Sang",   icon: "droplet" },
  { id: "urine",  label: "Urine",  icon: "vial" },
  { id: "swab",   label: "Frottis", icon: "syringe" },
  { id: "stool",  label: "Selles", icon: "flask" },
];

// Distance approx via formule du haversine (km). Le backend renvoie
// `distance_km` quand il peut, mais quand on est en fallback /labs/
// classique on calcule côté client pour ordonner et filtrer.
function distanceKm(a, b) {
  if (!a || !b) return null;
  const R_EARTH = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2
          + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(x));
}

const norm = (s) => (s || "").toString().toLowerCase().trim();

export default function HomeScreen({ navigation }) {
  const { user } = useAuth();
  const [labs, setLabs] = useState([]);
  // catalogsByLab[uuid] = [{code, name, sample_type, price_mru, …}]
  const [catalogsByLab, setCatalogsByLab] = useState({});
  const [catalogsLoading, setCatalogsLoading] = useState(false);
  const [loc, setLoc] = useState(null);
  const [filter, setFilter] = useState("all");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState(null);
  const aliveRef = useRef(true);

  useEffect(() => () => { aliveRef.current = false; }, []);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Géoloc précise
      let here = null;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        }
      } catch { /* fallback Nouakchott */ }
      if (!here) here = DEFAULT_LOCATION;
      if (aliveRef.current) setLoc(here);

      // Labos à proximité (fallback complet si l'endpoint nearby échoue)
      let arr = [];
      try {
        arr = await api.fetchLabsNearby(here.lat, here.lng, 50);
      } catch {
        try { arr = await api.fetchLabs(); } catch { arr = []; }
      }
      // Calcule la distance localement quand le backend n'a pas renvoyé.
      arr = arr.map((l) => {
        if (l.distance_km || !l.latitude || !l.longitude || !here) return l;
        return { ...l, distance_km: distanceKm(here, { lat: l.latitude, lng: l.longitude }) };
      });
      // Tri par distance croissante
      arr.sort((a, b) => (a.distance_km ?? 999) - (b.distance_km ?? 999));
      if (aliveRef.current) setLabs(arr);
    } finally {
      if (aliveRef.current) { setLoading(false); setRefreshing(false); }
    }
  };
  useEffect(() => { load(); }, []);

  /**
   * Charge les catalogues des labos à la demande, la 1ʳᵉ fois qu'on a une
   * requête texte non vide. Une fois en cache, on ne re-fetche pas.
   * Limite intentionnelle : on ne hit que les 12 labos les plus proches
   * pour éviter un fan-out trop large dans une démo (à terme un endpoint
   * backend `/search/?q=...` ferait ça mieux).
   */
  const ensureCatalogs = useCallback(async () => {
    if (catalogsLoading) return;
    const toFetch = labs
      .slice(0, 12)
      .map((l) => l.uuid)
      .filter((u) => !catalogsByLab[u]);
    if (toFetch.length === 0) return;
    setCatalogsLoading(true);
    try {
      const results = await Promise.allSettled(
        toFetch.map((u) => api.fetchLabCatalog(u).then((items) => [u, items])),
      );
      const next = {};
      for (const r of results) {
        if (r.status === "fulfilled") {
          const [uuid, items] = r.value;
          next[uuid] = items || [];
        }
      }
      if (aliveRef.current && Object.keys(next).length) {
        setCatalogsByLab((prev) => ({ ...prev, ...next }));
      }
    } finally {
      if (aliveRef.current) setCatalogsLoading(false);
    }
  }, [labs, catalogsByLab, catalogsLoading]);

  // Déclenche le chargement des catalogues dès qu'une recherche commence
  // ET qu'une catégorie autre que "toutes" est active. Pas de fetch si
  // l'utilisateur ne cherche rien (réduit le trafic).
  useEffect(() => {
    const hasQuery = query.trim().length >= 2;
    const hasCategory = category !== "all";
    if (hasQuery || hasCategory) ensureCatalogs();
  }, [query, category, ensureCatalogs]);

  // ── Filtrage + matches ──────────────────────────────────────────────
  const q = norm(query);
  const filtered = useMemo(() => {
    return labs
      .map((l) => {
        const cat = catalogsByLab[l.uuid] || [];

        // Tests qui matchent la recherche (code/name) ET la catégorie
        const matchingTests = cat.filter((t) => {
          if (category !== "all" && (t.sample_type || "").toLowerCase() !== category) return false;
          if (!q) return true;
          return (
            norm(t.code).includes(q)
            || norm(t.name).includes(q)
          );
        });

        // Détermine si le labo lui-même matche
        const labMatches = q
          ? `${norm(l.name)} ${norm(l.city)} ${norm(l.address)}`.includes(q)
          : true;

        // On garde si :
        //   - aucun critère (filtre + recherche) → on garde tout
        //   - sinon : il faut soit que le labo matche, soit qu'il y ait des tests qui matchent
        const matched = (!q && category === "all") || labMatches || matchingTests.length > 0;

        return {
          ...l,
          matched,
          matchingTests,
          matchCount: matchingTests.length,
        };
      })
      .filter((l) => {
        if (!l.matched) return false;
        if (filter === "open" && !(l.is_open ?? true)) return false;
        if (filter === "domicile" && !l.accepts_home_visits) return false;
        if (filter === "cnam" && !l.accepts_cnam) return false;
        if (filter === "near" && (l.distance_km ?? 999) > 5) return false;
        return true;
      });
  }, [labs, catalogsByLab, q, category, filter]);

  // Compteur global d'analyses qui matchent (toutes labos confondus)
  const totalMatchingTests = useMemo(
    () => filtered.reduce((s, l) => s + (l.matchCount || 0), 0),
    [filtered],
  );

  const firstName = user?.first_name || "vous";
  const onPickLab = (lab) => navigation.navigate("LabDetail", { lab });
  const onOpenFullMap = () => navigation.navigate("Map", {
    labs: filtered.length ? filtered : labs,
    userLoc: loc,
  });

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
                {/* Cloche notifications — badge unread géré par le
                    composant lui-même (poll backend toutes les 30 s). */}
                <NotificationsBell navigation={navigation} />
              </View>

              {/* Recherche */}
              <View style={styles.searchBox}>
                <Icon name="search" size={20} color={C.inkSoft} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Labo, analyse, code (NFS, GLY…)"
                  placeholderTextColor={C.inkSoft}
                  style={styles.searchInput}
                  returnKeyType="search"
                />
                {query.length > 0 && (
                  <TouchableOpacity onPress={() => setQuery("")} style={{ padding: 4 }}>
                    <Icon name="close" size={18} color={C.inkSoft} />
                  </TouchableOpacity>
                )}
                {catalogsLoading && <ActivityIndicator size="small" color={C.brand} />}
              </View>

              {/* Bandeau de résultats — affiché dès qu'on cherche / filtre */}
              {(q || category !== "all") && (
                <View style={styles.resultBanner}>
                  <Icon name="flask" size={15} color={C.brand} />
                  <Text style={styles.resultBannerText}>
                    {totalMatchingTests > 0
                      ? `${totalMatchingTests} analyse${totalMatchingTests > 1 ? "s" : ""} dans ${filtered.length} labo${filtered.length > 1 ? "s" : ""}`
                      : `${filtered.length} labo${filtered.length > 1 ? "s" : ""} correspondent`}
                  </Text>
                </View>
              )}
            </SafeAreaView>

            {/* Mini map agrandie (260px) — tap = fullscreen */}
            <Pressable onPress={onOpenFullMap} style={styles.mapCard}>
              <LabMapView
                labs={(filtered.length ? filtered : labs).slice(0, 20)}
                userLocation={loc}
                onLabPress={(uuid) => setSelected(uuid)}
                height={260}
              />
              <View pointerEvents="none" style={styles.mapBadge}>
                <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: C.leaf }} />
                <Text style={styles.mapBadgeText}>
                  {labs.length} labos à proximité
                </Text>
              </View>
              <View pointerEvents="none" style={styles.mapExpandBadge}>
                <Icon name="chevronR" size={14} color="#fff" />
                <Text style={styles.mapExpandText}>Plein écran</Text>
              </View>
              {selected ? (() => {
                const l = labs.find((x) => x.uuid === selected);
                if (!l) return null;
                return (
                  <TouchableOpacity
                    activeOpacity={0.9}
                    onPress={(e) => { e.stopPropagation && e.stopPropagation(); onPickLab(l); }}
                    style={styles.mapCallout}
                  >
                    <View style={[styles.labLogo, { backgroundColor: hexA(labColor(l.uuid), 0.16) }]}>
                      <Icon name={labIcon(l.uuid)} size={26} color={labColor(l.uuid)} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.calloutName}>{l.name}</Text>
                      <Text style={styles.calloutSub}>
                        {l.distance_km != null ? `${l.distance_km.toFixed(1)} km` : ""}
                        {l.eta_min ? ` · ${l.eta_min} min` : ""}
                      </Text>
                    </View>
                    <Icon name="chevronR" size={22} color={C.brand} />
                  </TouchableOpacity>
                );
              })() : null}
            </Pressable>

            {/* CNAM banner */}
            <View style={styles.cnamBanner}>
              <View style={styles.cnamIcon}>
                <Icon name="shieldFill" size={24} color={C.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cnamTitle}>
                  {user?.cnam_number
                    ? `CNAM ${user.cnam_coverage_pct ?? 0}% prise en charge`
                    : "Prise en charge CNAM"}
                </Text>
                <Text style={styles.cnamSub}>
                  {user?.cnam_number
                    ? "Appliquée automatiquement à vos analyses éligibles"
                    : "Ajoutez votre carte depuis Profil pour profiter du remboursement"}
                </Text>
              </View>
            </View>

            {/* Filtres principaux */}
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

            {/* Filtres par catégorie d'analyse (sang/urine/...) */}
            <View style={[styles.filtersWrap, { marginTop: 8 }]}>
              <FlatList
                horizontal
                data={CATEGORIES}
                keyExtractor={(c) => c.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
                renderItem={({ item }) => (
                  <Chip
                    active={category === item.id}
                    onPress={() => setCategory(item.id)}
                    icon={item.icon}
                  >
                    {item.label}
                  </Chip>
                )}
              />
            </View>

            {/* Section title */}
            <View style={{ paddingHorizontal: 20, marginTop: 18 }}>
              <SectionTitle>
                {q || category !== "all" ? "Labos correspondants" : "Labos près de vous"}
              </SectionTitle>
            </View>
          </>
        }
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
            <LabCard
              lab={item}
              onPress={() => onPickLab(item)}
              selected={item.uuid === selected}
              searching={!!(q || category !== "all")}
            />
          </View>
        )}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={C.brand} style={{ marginTop: 30 }} />
          ) : (
            <View style={{ alignItems: "center", paddingTop: 40, gap: 8 }}>
              <Icon name="search" size={42} color={C.inkSoft} />
              <Text style={styles.empty}>
                Aucun labo ne correspond à vos critères.
              </Text>
              {(q || category !== "all" || filter !== "all") && (
                <TouchableOpacity
                  onPress={() => { setQuery(""); setCategory("all"); setFilter("all"); }}
                  style={styles.resetBtn}
                >
                  <Text style={styles.resetBtnText}>Réinitialiser les filtres</Text>
                </TouchableOpacity>
              )}
            </View>
          )
        }
      />
    </View>
  );
}

// ── LabCard ─────────────────────────────────────────────────────────────
function LabCard({ lab, onPress, selected, searching }) {
  const color = labColor(lab.uuid);
  const isOpen = lab.is_open ?? true;
  const distance = lab.distance_km != null
    ? `${lab.distance_km.toFixed(1)} km`
    : (lab.city || "Nouakchott");
  const eta = lab.eta_min ? `${lab.eta_min} min` : null;

  const matches = lab.matchingTests || [];
  const previewTests = matches.slice(0, 3);

  return (
    <Card
      onPress={onPress}
      pad={14}
      style={[
        { flexDirection: "column", gap: 10 },
        selected && { borderWidth: 2, borderColor: C.brand },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 13 }}>
        <View style={[styles.labLogo, { backgroundColor: hexA(color, 0.16) }]}>
          <Icon name={labIcon(lab.uuid)} size={30} color={color} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text numberOfLines={1} style={styles.labName}>{lab.name}</Text>
            {lab.rating ? <Stars value={lab.rating} /> : null}
          </View>
          <Text style={styles.labMeta} numberOfLines={1}>
            {lab.address ? `${distance} · ${lab.address}` : distance}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            <Tag color={isOpen ? C.leaf : "#9AA7AC"} icon="clock">
              {isOpen ? (eta ? `Ouvert · ${eta}` : "Ouvert") : "Fermé"}
            </Tag>
            {lab.accepts_cnam && <Tag color={C.brand} icon="shield">CNAM</Tag>}
            {lab.accepts_home_visits && <Tag color={C.grape} icon="house2">Domicile</Tag>}
            {searching && lab.matchCount > 0 && (
              <Tag color={C.coral} icon="flask">
                {lab.matchCount} analyse{lab.matchCount > 1 ? "s" : ""}
              </Tag>
            )}
          </View>
        </View>
      </View>

      {/* Preview des analyses correspondantes — affiché seulement en recherche */}
      {searching && previewTests.length > 0 && (
        <View style={styles.matchPreview}>
          {previewTests.map((t) => (
            <View key={t.uuid} style={styles.matchPreviewRow}>
              <Icon name="flask" size={13} color={C.brand} />
              <Text style={styles.matchPreviewCode}>{t.code}</Text>
              <Text style={styles.matchPreviewName} numberOfLines={1}>{t.name}</Text>
              {t.price_mru && (
                <Text style={styles.matchPreviewPrice}>
                  {Number(t.price_mru).toLocaleString("fr-FR")} UM
                </Text>
              )}
            </View>
          ))}
          {matches.length > previewTests.length && (
            <Text style={styles.matchPreviewMore}>
              + {matches.length - previewTests.length} autre{matches.length - previewTests.length > 1 ? "s" : ""}
            </Text>
          )}
        </View>
      )}
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

  resultBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 20, marginTop: 10,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: hexA(C.brand, 0.08), borderRadius: 12,
  },
  resultBannerText: { fontSize: 12.5, fontWeight: "800", color: C.brandDeep || C.brand },

  mapCard: {
    marginHorizontal: 20, marginTop: 12,
    borderRadius: R.lg, overflow: "hidden", ...SHADOW.md,
    backgroundColor: "#E8F1F0",
  },
  mapBadge: {
    position: "absolute", top: 12, left: 12,
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
  },
  mapBadgeText: { fontSize: 12.5, fontWeight: "800", color: C.ink, fontFamily: F.bodyBold },
  mapExpandBadge: {
    position: "absolute", top: 12, right: 12,
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: C.brand,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
  },
  mapExpandText: { fontSize: 11.5, fontWeight: "800", color: "#fff" },
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
  cnamTitle: { fontSize: 14.5, fontWeight: "700", color: C.ink, fontFamily: F.displayBold },
  cnamSub:   { fontSize: 12, fontWeight: "700", color: C.inkSoft, marginTop: 1, fontFamily: F.body },

  filtersWrap: { marginTop: 18 },

  labLogo: {
    width: 58, height: 58, borderRadius: 18,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  labName: { fontSize: 16.5, fontWeight: "700", color: C.ink, flexShrink: 1, fontFamily: F.displayBold },
  labMeta: { fontSize: 13, fontWeight: "600", color: C.inkSoft, marginTop: 2, fontFamily: F.body },

  matchPreview: {
    backgroundColor: C.bg, borderRadius: 12,
    padding: 10, gap: 6,
  },
  matchPreviewRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  matchPreviewCode: { fontSize: 12.5, fontWeight: "800", color: C.brand, fontFamily: F.bodyBold },
  matchPreviewName: { flex: 1, fontSize: 12.5, fontWeight: "700", color: C.ink },
  matchPreviewPrice:{ fontSize: 12, fontWeight: "800", color: C.inkSoft, fontFamily: F.bodyBold },
  matchPreviewMore: {
    fontSize: 11.5, fontWeight: "700", color: C.brandDeep || C.brand,
    marginTop: 4, paddingLeft: 21,
  },

  empty: { textAlign: "center", color: C.inkSoft, padding: 12, fontWeight: "700" },
  resetBtn: {
    marginTop: 12, paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 999, backgroundColor: hexA(C.brand, 0.10),
  },
  resetBtnText: { fontSize: 13, fontWeight: "800", color: C.brandDeep || C.brand },
});
