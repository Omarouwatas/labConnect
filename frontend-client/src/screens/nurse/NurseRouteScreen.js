// NurseRouteScreen — « Tournée du jour » : timeline des visites assignées.
//
// Reprise du design « SmartLab — Infirmier » (variation A vert médical
// sketch) adapté au système turquoise + Fredoka/Nunito de labConnect :
//   - en-tête avec avatar de l'infirmier·e + greeting
//   - 3 KPI (visites faites / nombre de prélèvements / km à parcourir)
//   - timeline verticale : heure + pastille statut + carte visite avec
//     patient, adresse, analyses (chips), badge « À jeun » si requis
//   - la carte « En cours » a un halo turquoise pour la mettre en avant
//
// La carte est cliquable → push « NurseMission ». Le screen est l'écran
// principal du tab nurse (cf. App.js → NurseTabs).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, RefreshControl, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as api from "../../api";
import { useAuth } from "../../auth";
import { C, R, SHADOW, F } from "../../theme";
import { Avatar, Card, Tag, StatusBadge, hexA } from "../../components/UI";
import { Icon } from "../../icons";
import NotificationsBell from "../../components/NotificationsBell";

/** Une visite est « du jour » si scheduled_for tombe aujourd'hui (heure
 *  locale). Le backend retourne aussi du futur proche, on filtre côté
 *  client pour ne montrer que la tournée d'aujourd'hui sur cet écran. */
function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return d.toDateString() === n.toDateString();
}

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("fr-FR", {
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

// Mapping statut RDV → couleur/intent visuel pour la pastille de timeline.
// pending = à venir (creux), confirmed/checked_in = en attente (ring),
// in_progress = en cours (halo brand), completed = fait (rempli leaf).
function timelineDot(status) {
  if (status === "completed") return { fill: C.leaf, ring: C.leaf, current: false };
  if (status === "in_progress") return { fill: "#fff", ring: C.brand, current: true };
  if (status === "checked_in")  return { fill: "#fff", ring: C.grape, current: false };
  if (status === "confirmed")   return { fill: "#fff", ring: C.brand, current: false };
  return { fill: C.bgElev, ring: C.hair, current: false };
}

function NurseRouteScreen({ navigation }) {
  const { user } = useAuth();
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.fetchMyVisits();
      setVisits(data);
    } catch (e) {
      setError(e?.detail || "Impossible de charger la tournée.");
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Recharge automatiquement quand on revient depuis NurseValidate
  // (cascade RDV → completed) pour que la timeline se mette à jour.
  useEffect(() => {
    const unsub = navigation.addListener("focus", () => {
      if (!loading) load();
    });
    return unsub;
  }, [navigation, load, loading]);

  const todayVisits = useMemo(
    () => visits.filter((v) => isToday(v.scheduled_for))
      .sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for)),
    [visits],
  );

  const kpis = useMemo(() => {
    const done = todayVisits.filter((v) => v.status === "completed").length;
    const samples = todayVisits.reduce(
      (s, v) => s + (v.items?.length || 0),
      0,
    );
    return { done, total: todayVisits.length, samples };
  }, [todayVisits]);

  const greetingName = (() => {
    const f = user?.first_name;
    if (f) return f;
    return user?.phone || "vous";
  })();

  const onOpenVisit = (v) => {
    navigation.navigate("NurseMission", { visitUuid: v.uuid });
  };

  // ── Render ────────────────────────────────────────────────────────────
  const renderItem = ({ item, index }) => {
    const d = timelineDot(item.status);
    const isNext = item.status === "in_progress"
      || (item.status === "confirmed" && index === todayVisits.findIndex(
        (v) => v.status === "confirmed" || v.status === "pending",
      ));
    return (
      <View style={styles.row}>
        {/* Rail timeline : heure + pastille + ligne verticale */}
        <View style={styles.rail}>
          <Text style={[
            styles.railTime,
            { color: isNext ? C.brandDeep : C.ink, fontFamily: F.displayBold || F.display },
          ]}>
            {fmtTime(item.scheduled_for)}
          </Text>
          <View
            style={[
              styles.railDot,
              { backgroundColor: d.fill, borderColor: d.ring },
              d.current && { borderWidth: 3 },
            ]}
          >
            {d.current && <View style={styles.railDotInner} />}
          </View>
          {index < todayVisits.length - 1 && <View style={styles.railLine} />}
        </View>

        {/* Carte visite */}
        <View style={{ flex: 1, paddingBottom: 14 }}>
          <View style={{ position: "relative" }}>
            {isNext && <View style={styles.haloNext} pointerEvents="none" />}
            <Card onPress={() => onOpenVisit(item)} pad={14} style={styles.visitCard}>
              <View style={styles.visitHeader}>
                <Text
                  style={[styles.visitName, { fontFamily: F.displayBold || F.display }]}
                  numberOfLines={1}
                >
                  {item.patient_name || "—"}
                </Text>
                <StatusBadge status={item.status} />
              </View>
              <View style={styles.visitRow}>
                <Icon name="pin" size={14} color={C.brand} />
                <Text
                  style={[styles.visitAddr, { fontFamily: F.body || F.bodyBold }]}
                  numberOfLines={1}
                >
                  {item.home_address || "Adresse non renseignée"}
                </Text>
              </View>
              <View style={styles.visitChips}>
                {(item.items || []).slice(0, 4).map((it, i) => (
                  <Tag
                    key={i}
                    icon="vial"
                    color={C.brand}
                    style={{ marginRight: 6, marginTop: 6 }}
                  >
                    {it.test_code}
                  </Tag>
                ))}
                {(item.items?.length || 0) > 4 && (
                  <Tag color={C.inkSoft} style={{ marginRight: 6, marginTop: 6 }}>
                    +{item.items.length - 4}
                  </Tag>
                )}
                {(item.items || []).length === 0 && (
                  <Tag color={C.inkSoft} style={{ marginTop: 6 }}>
                    Tests à confirmer
                  </Tag>
                )}
              </View>
            </Card>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView edges={["top"]}>
        <View style={styles.headerBlock}>
          {/* En-tête infirmier·e */}
          <View style={styles.headerRow}>
            <Avatar name={greetingName} size={50} color={C.brand} />
            <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
              <Text style={[styles.hello, { fontFamily: F.body || F.bodyBold }]}>
                Bonjour,
              </Text>
              <Text style={[styles.helloName, { fontFamily: F.displayBold || F.display }]} numberOfLines={1}>
                {greetingName}
              </Text>
            </View>
            {/* Cloche notifications — utile pour la nurse aussi (affectation,
                annulation patient, etc.). */}
            <NotificationsBell navigation={navigation} />
          </View>

          {/* Titre + sous-titre */}
          <Text style={[styles.title, { fontFamily: F.displayBold || F.display }]}>
            Tournée du jour
          </Text>
          <Text style={[styles.subtitle, { fontFamily: F.body || F.bodyBold }]}>
            {new Date().toLocaleDateString("fr-FR", {
              weekday: "long", day: "2-digit", month: "long",
            })} · {todayVisits.length} visite{todayVisits.length > 1 ? "s" : ""} à domicile
          </Text>

          {/* KPI */}
          <View style={styles.kpiRow}>
            <Kpi
              icon="check"
              value={`${kpis.done}/${kpis.total}`}
              label="visites"
            />
            <Kpi
              icon="syringe"
              value={kpis.samples}
              label="prélèv."
            />
            <Kpi
              icon="route"
              value={todayVisits.length > 0 ? `${todayVisits.length}` : "0"}
              label="étapes"
            />
          </View>
        </View>
      </SafeAreaView>

      {loading ? (
        <ActivityIndicator color={C.brand} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={todayVisits}
          keyExtractor={(v) => v.uuid}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={C.brand}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon name="route" size={42} color={C.inkSoft} />
              <Text style={[styles.emptyTitle, { fontFamily: F.displayBold || F.display }]}>
                Pas de visite aujourd'hui
              </Text>
              <Text style={[styles.emptySub, { fontFamily: F.body || F.bodyBold }]}>
                {error
                  ? error
                  : "La secrétaire vous affectera des visites depuis la console web. Tirez pour rafraîchir."}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

function Kpi({ icon, value, label }) {
  return (
    <View style={styles.kpi}>
      <View style={styles.kpiTopRow}>
        <Icon name={icon} size={15} color={C.brand} />
        <Text style={[styles.kpiVal, { fontFamily: F.displayBold || F.display }]}>{value}</Text>
      </View>
      <Text style={[styles.kpiLabel, { fontFamily: F.body || F.bodyBold }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerBlock: {
    paddingHorizontal: 20, paddingTop: 6, paddingBottom: 12,
  },
  headerRow: { flexDirection: "row", alignItems: "center" },
  hello:     { fontSize: 13, color: C.inkSoft },
  helloName: { fontSize: 22, fontWeight: "700", color: C.ink, lineHeight: 26 },
  title:     { fontSize: 28, fontWeight: "700", color: C.ink, marginTop: 14, lineHeight: 32 },
  subtitle:  { fontSize: 13, color: C.inkSoft, marginTop: 4 },

  kpiRow:   { flexDirection: "row", marginTop: 12, gap: 8 },
  kpi: {
    flex: 1, backgroundColor: "#fff", borderRadius: R.md,
    paddingVertical: 10, paddingHorizontal: 12, ...SHADOW.sm,
  },
  kpiTopRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  kpiVal:    { fontSize: 18, fontWeight: "700", color: C.ink },
  kpiLabel:  { fontSize: 11, color: C.inkSoft, marginTop: 2 },

  // Timeline
  row:       { flexDirection: "row" },
  rail:      { width: 56, alignItems: "center" },
  railTime:  { fontSize: 14, fontWeight: "700", marginBottom: 4 },
  railDot: {
    width: 14, height: 14, borderRadius: 999, borderWidth: 2,
    alignItems: "center", justifyContent: "center",
  },
  railDotInner: { width: 5, height: 5, borderRadius: 999, backgroundColor: C.brand },
  railLine:  { flex: 1, width: 2, backgroundColor: C.hair, marginTop: 4, minHeight: 28 },

  haloNext: {
    position: "absolute", inset: -4, borderRadius: R.lg,
    borderWidth: 2, borderColor: C.brand, borderStyle: "dashed",
    opacity: 0.45,
  },

  visitCard: { backgroundColor: "#fff" },
  visitHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  visitName: { flex: 1, fontSize: 16, fontWeight: "700", color: C.ink, minWidth: 0 },
  visitRow:  { flexDirection: "row", alignItems: "center", marginTop: 6, gap: 6 },
  visitAddr: { flex: 1, fontSize: 13, color: C.inkSoft, minWidth: 0 },
  visitChips:{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 },

  empty: {
    alignItems: "center", padding: 32, marginTop: 24,
    backgroundColor: "#fff", borderRadius: R.lg, marginHorizontal: 20,
    ...SHADOW.sm,
  },
  emptyTitle: { fontSize: 18, color: C.ink, marginTop: 10, fontWeight: "700" },
  emptySub:   { fontSize: 13, color: C.inkSoft, marginTop: 6, textAlign: "center", lineHeight: 18 },
});

export default NurseRouteScreen;
