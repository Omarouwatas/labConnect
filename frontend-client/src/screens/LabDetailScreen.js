// LabDetailScreen — version turquoise médicale Glovo.
// Hero banner avec emojis flottants + logo, info row (rating, distance,
// CNAM, specialités), mode toggle laboratoire/domicile, chips catégories,
// liste analyses avec bouton + arrondi, sticky footer "Réserver".
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert,
} from "react-native";
import * as api from "../api";
import { C, R, SHADOW, F, CURRENCY, CATEGORY_COLOR, labColor, labIcon } from "../theme";
import { Btn, Chip, IconBtn, Tag, FloatBack, SectionTitle, hexA } from "../components/UI";
import { Icon } from "../icons";

export default function LabDetailScreen({ route, navigation }) {
  const { lab } = route.params;
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState(lab.accepts_home_visits ? "labo" : "labo");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState({}); // { [uuid]: true }
  const aliveRef = useRef(true);

  useEffect(() => () => { aliveRef.current = false; }, []);
  useEffect(() => {
    (async () => {
      try {
        const arr = await api.fetchLabCatalog(lab.uuid);
        if (aliveRef.current) setCatalog(arr.filter((t) => t.is_active));
      } catch (e) {
        if (aliveRef.current) setError(e?.detail || "Catalogue indisponible.");
      } finally {
        if (aliveRef.current) setLoading(false);
      }
    })();
  }, [lab.uuid]);

  // Catégories disponibles depuis le catalog (sample_type)
  const cats = useMemo(() => {
    const set = new Set(catalog.map((t) => t.sample_type).filter(Boolean));
    return ["all", ...Array.from(set)];
  }, [catalog]);

  const visible = useMemo(() => (
    category === "all" ? catalog : catalog.filter((t) => t.sample_type === category)
  ), [catalog, category]);

  const selectedTests = useMemo(
    () => catalog.filter((t) => selected[t.uuid]),
    [catalog, selected],
  );
  const total = useMemo(
    () => selectedTests.reduce((s, t) => s + Number(t.price_mru || 0), 0),
    [selectedTests],
  );

  const toggle = (uuid) => setSelected((s) => {
    const next = { ...s };
    if (next[uuid]) delete next[uuid]; else next[uuid] = true;
    return next;
  });

  const goCart = () => {
    if (!selectedTests.length) {
      Alert.alert("Choisissez d'abord", "Sélectionnez au moins une analyse.");
      return;
    }
    navigation.navigate("Cart", { lab, tests: selectedTests, mode });
  };

  const color = labColor(lab.uuid);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <FloatBack onBack={() => navigation.goBack()} right={<IconBtn name="heart" glyph={20} />} />
      <FlatList
        data={loading || error ? [] : visible}
        keyExtractor={(t) => t.uuid}
        contentContainerStyle={{ paddingBottom: 140 }}
        ListHeaderComponent={
          <>
            {/* Hero banner avec icônes médicales décoratives */}
            <View style={[styles.hero, { backgroundColor: color }]}>
              {["flask", "microscope", "syringe", "vial"].map((n, i) => (
                <View
                  key={i}
                  style={{
                    position: "absolute",
                    left: `${15 + i * 24}%`,
                    top: `${20 + (i % 2) * 45}%`,
                    transform: [{ rotate: `${i * 18 - 20}deg` }],
                    opacity: 0.28,
                  }}
                >
                  <Icon name={n} size={36} color="#fff" />
                </View>
              ))}
              <View style={styles.heroFade} />
              <View style={styles.heroLogo}>
                <Icon name={labIcon(lab.uuid)} size={36} color={color} />
              </View>
            </View>

            {/* Info row */}
            <View style={{ padding: 20, paddingTop: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                <Text style={styles.title} numberOfLines={2}>{lab.name}</Text>
                {lab.rating ? (
                  <View style={styles.ratingPill}>
                    <Icon name="star" size={14} color={C.sun} />
                    <Text style={styles.ratingValue}>{Number(lab.rating).toFixed(1)}</Text>
                    {lab.reviews_count ? (
                      <Text style={styles.ratingCount}>({lab.reviews_count})</Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
              <View style={styles.metaRow}>
                <Icon name="pin" size={14} color={C.inkSoft} />
                <Text style={styles.metaText}>{lab.address || lab.city || "Nouakchott"}</Text>
                {lab.distance_km ? (
                  <Text style={styles.metaText}> · {lab.distance_km.toFixed(1)} km</Text>
                ) : null}
                <Text style={[styles.metaText, { color: C.leaf, fontWeight: "800" }]}>
                  {" · "}{lab.is_open ?? true ? "Ouvert" : "Fermé"}
                </Text>
              </View>
              <View style={styles.tagsRow}>
                {lab.accepts_cnam && <Tag color={C.brand} icon="shield">Conventionné CNAM</Tag>}
                {lab.accepts_home_visits && <Tag color={C.grape} icon="house2">Domicile</Tag>}
                {lab.accepts_emergencies && <Tag color={C.coral} icon="alert">Urgences</Tag>}
              </View>
            </View>

            {/* Mode toggle */}
            <View style={styles.modeRow}>
              {[
                { id: "labo", icon: "hospital", label: "Au laboratoire", sub: "Gratuit", available: true },
                { id: "domicile", icon: "house2", label: "À domicile", sub: lab.accepts_home_visits ? `+${lab.home_visit_fee_mru || 500} MRU · infirmier` : "Indisponible", available: !!lab.accepts_home_visits },
              ].map((m) => {
                const on = mode === m.id;
                return (
                  <TouchableOpacity
                    key={m.id}
                    disabled={!m.available}
                    onPress={() => setMode(m.id)}
                    style={[
                      styles.modeBtn,
                      on && { borderColor: C.brand, backgroundColor: hexA(C.brand, 0.08) },
                      !m.available && { opacity: 0.4 },
                    ]}
                    activeOpacity={0.85}
                  >
                    <Icon name={m.icon} size={22} color={on ? C.brand : C.ink} />
                    <Text style={[styles.modeLabel, on && { color: C.brandDeep }]}>{m.label}</Text>
                    <Text style={styles.modeSub}>{m.sub}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Analyses section */}
            <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
              <SectionTitle>Choisir vos analyses</SectionTitle>
            </View>
            <FlatList
              horizontal
              data={cats}
              keyExtractor={(c) => c}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingBottom: 14 }}
              renderItem={({ item }) => (
                <Chip
                  active={category === item}
                  onPress={() => setCategory(item)}
                >
                  {item === "all" ? "Tous" : CATEGORY_LABEL[item] || item}
                </Chip>
              )}
            />
            {error ? (
              <Text style={[styles.empty, { color: C.coral }]}>⚠ {error}</Text>
            ) : null}
          </>
        }
        renderItem={({ item: t }) => (
          <View style={{ paddingHorizontal: 20, marginBottom: 10 }}>
            <AnalyseRow
              test={t}
              selected={!!selected[t.uuid]}
              onToggle={() => toggle(t.uuid)}
            />
          </View>
        )}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={C.brand} style={{ marginTop: 20 }} />
          ) : null
        }
      />

      {/* Sticky footer "Réserver" */}
      {selectedTests.length > 0 && (
        <View style={styles.footer}>
          <Btn full size="lg" onPress={goCart}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
              <View style={styles.footerCount}>
                <Text style={styles.footerCountText}>{selectedTests.length}</Text>
              </View>
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Réserver</Text>
            </View>
            <Text style={{ marginLeft: "auto", color: "#fff", fontWeight: "700", fontSize: 15 }}>
              {CURRENCY.format(total)}
            </Text>
          </Btn>
        </View>
      )}
    </View>
  );
}

// ── AnalyseRow ──────────────────────────────────────────────────────────
function AnalyseRow({ test, selected, onToggle }) {
  const color = CATEGORY_COLOR[test.sample_type] || C.brand;
  // Choix de l'icône en fonction du type d'échantillon.
  const icon = ICON_BY_TYPE[test.sample_type] || "vial";
  return (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={onToggle}
      style={[
        styles.analyseRow,
        selected && { borderWidth: 2, borderColor: C.brand },
      ]}
    >
      <View style={[styles.analyseIcon, { backgroundColor: hexA(color, 0.15) }]}>
        <Icon name={icon} size={24} color={color} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.analyseName} numberOfLines={2}>{test.name}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 5 }}>
          <Text style={styles.analysePrice}>{CURRENCY.format(test.price_mru)}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Icon name="clock" size={12} color={C.inkSoft} />
            <Text style={styles.analyseTime}>{test.turnaround_hours}h</Text>
          </View>
          {test.requires_fasting && <Tag color={C.sun}>À jeun</Tag>}
          {(test.prerequisite_questions || []).length > 0 && (
            <Tag color={C.grape} icon="document">{test.prerequisite_questions.length}</Tag>
          )}
        </View>
      </View>
      <View style={[
        styles.plusBtn,
        selected ? { backgroundColor: C.brand } : { backgroundColor: hexA(C.brand, 0.12) },
      ]}>
        <Icon name={selected ? "check" : "plus"} size={22} color={selected ? "#fff" : C.brand} />
      </View>
    </TouchableOpacity>
  );
}

const ICON_BY_TYPE = {
  blood:  "droplet",
  urine:  "flask",
  stool:  "flask",
  saliva: "droplet",
  swab:   "syringe",
  other:  "vial",
};

const CATEGORY_LABEL = {
  blood:  "Sang",
  urine:  "Urine",
  stool:  "Selles",
  saliva: "Salive",
  swab:   "Prélèvement",
  other:  "Autre",
};

const styles = StyleSheet.create({
  hero: {
    height: 168,
    position: "relative",
    overflow: "hidden",
  },
  heroFade: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    height: 60,
    backgroundColor: hexA(C.bg, 0.7),
  },
  heroLogo: {
    position: "absolute", bottom: 18, left: 20,
    width: 70, height: 70, borderRadius: 22,
    backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center",
    ...SHADOW.md,
  },

  title: { flex: 1, fontSize: 24, fontWeight: "700", color: C.ink, lineHeight: 27, fontFamily: F.displayBold },

  ratingPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: hexA(C.sun, 0.16),
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
  },
  ratingValue: { fontWeight: "700", fontSize: 14, color: C.ink, fontFamily: F.displayBold },
  ratingCount: { fontWeight: "700", fontSize: 12, color: C.inkSoft, fontFamily: F.body },

  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8, marginBottom: 12 },
  metaText: { fontSize: 13, fontWeight: "700", color: C.inkSoft, fontFamily: F.body },

  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },

  modeRow: { flexDirection: "row", gap: 10, marginHorizontal: 20, marginTop: 6 },
  modeBtn: {
    flex: 1, backgroundColor: "#fff",
    borderWidth: 2, borderColor: C.hair,
    borderRadius: 18, padding: 14,
  },
  modeLabel: { fontSize: 14, fontWeight: "700", color: C.ink, marginTop: 5, fontFamily: F.displayBold },
  modeSub:   { fontSize: 11.5, fontWeight: "700", color: C.inkSoft, marginTop: 2, fontFamily: F.body },

  analyseRow: {
    flexDirection: "row", alignItems: "center", gap: 13,
    backgroundColor: "#fff", borderRadius: 18, padding: 13,
    ...SHADOW.sm,
  },
  analyseIcon: {
    width: 46, height: 46, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  analyseName:  { fontSize: 14.5, fontWeight: "600", color: C.ink, lineHeight: 18, fontFamily: F.display },
  analysePrice: { fontSize: 14, fontWeight: "700", color: C.ink, fontFamily: F.displayBold },
  analyseTime:  { fontSize: 11.5, fontWeight: "700", color: C.inkSoft, fontFamily: F.body },
  plusBtn: {
    width: 36, height: 36, borderRadius: 999,
    alignItems: "center", justifyContent: "center",
  },

  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    padding: 20, paddingBottom: 30, backgroundColor: "#fff",
    ...SHADOW.md,
  },
  footerCount: {
    minWidth: 24, height: 24, borderRadius: 999,
    paddingHorizontal: 8,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center", justifyContent: "center",
  },
  footerCountText: { color: "#fff", fontWeight: "800", fontSize: 13 },

  empty: { textAlign: "center", padding: 20, color: C.inkSoft, fontWeight: "600" },
});
