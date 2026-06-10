// NurseMissionScreen — détail d'une visite à domicile.
//
// Reprend la maquette « Détail mission » du design Infirmier :
//   - fiche patient (nom, âge, ID) + bouton Appeler
//   - mini-carte avec adresse + bouton itinéraire (distance km)
//   - liste des analyses à prélever (chaque test = tube + bouchon coloré,
//     nom du test, prix patient à charge)
//   - bloc consignes : à jeun si requis, notes du RDV
//   - CTA bas : « Démarrer le prélèvement » → push NurseCollect, qui
//     déclenche la cascade RDV → in_progress côté backend.
//
// Param : route.params.visitUuid (push depuis NurseRouteScreen).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Linking,
  ActivityIndicator, TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as api from "../../api";
import { C, R, SHADOW, F, CURRENCY } from "../../theme";
import { Btn, Card, IconBtn, Tag, StatusBadge, Avatar, hexA } from "../../components/UI";
import { Icon } from "../../icons";

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("fr-FR", {
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

// Couleur de bouchon par type d'échantillon — calé sur la convention
// du design (EDTA mauve, sec rouge, fluoré gris) et étendu pour les
// autres sample_types (urine, salive, etc.).
function capColor(sampleType) {
  switch ((sampleType || "").toLowerCase()) {
    case "blood":  return C.coral;   // tube sec (le plus courant en cabine)
    case "urine":  return C.sun;
    case "stool":  return C.leaf;
    case "saliva": return C.brand;
    case "swab":   return C.grape;
    default:       return C.grape;
  }
}

function NurseMissionScreen({ route, navigation }) {
  const { visitUuid } = route.params || {};
  const [visit, setVisit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null); setLoading(true);
    try {
      const v = await api.fetchAppointment(visitUuid);
      setVisit(v);
    } catch (e) {
      setError(e?.detail || "Visite introuvable.");
    } finally { setLoading(false); }
  }, [visitUuid]);
  useEffect(() => { load(); }, [load]);

  // Recharge au focus — utile si la cascade côté Collect a touché les
  // items (items.status passe en in_progress).
  useEffect(() => {
    const unsub = navigation.addListener("focus", () => { if (!loading) load(); });
    return unsub;
  }, [navigation, load, loading]);

  const items = useMemo(() => visit?.items || [], [visit]);

  // Heuristique « à jeun » : on inspecte les notes du RDV + les items
  // pour repérer un test typiquement à jeun (glycémie, bilan lipidique,
  // HbA1c). Le backend n'expose pas le flag prerequisite côté nurse,
  // mais ces tests-là sont systématiquement à jeun.
  const isFasting = useMemo(() => {
    const notes = (visit?.notes || "").toLowerCase();
    if (notes.includes("jeun")) return true;
    const codes = items.map((it) => (it.test_code || "").toUpperCase());
    return codes.some((c) => ["GLY", "CHOL", "HBA1C", "LIPID", "BILAN"].includes(c));
  }, [items, visit]);

  // Bouton « Appeler » : utilise tel: deeplink natif. Si patient_phone
  // absent (ne devrait pas arriver) on désactive le bouton.
  const onCall = () => {
    if (visit?.patient_phone) {
      Linking.openURL(`tel:${visit.patient_phone}`).catch(() => {});
    }
  };

  // Itinéraire : ouvre Google Maps / Plans avec l'adresse texte (les
  // coordonnées GPS sont aussi exposées par le backend mais pas tous
  // les RDV en ont — on tombe sur l'adresse comme fallback).
  const onItinerary = () => {
    if (visit?.home_latitude && visit?.home_longitude) {
      Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${visit.home_latitude},${visit.home_longitude}`,
      ).catch(() => {});
    } else if (visit?.home_address) {
      Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(visit.home_address)}`,
      ).catch(() => {});
    }
  };

  // « Démarrer » → push NurseCollect, qui appelle startVisit() pour
  // déclencher la cascade côté backend.
  const onStart = () => {
    navigation.navigate("NurseCollect", { visitUuid });
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: "center" }}>
        <ActivityIndicator color={C.brand} />
      </View>
    );
  }
  if (error || !visit) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: 60, paddingHorizontal: 24 }}>
        <Text style={[styles.errTitle, { fontFamily: F.displayBold || F.display }]}>
          {error || "Visite introuvable"}
        </Text>
        <Btn onPress={() => navigation.goBack()} icon="chevronL" style={{ marginTop: 16 }}>
          Retour
        </Btn>
      </View>
    );
  }

  const subtitle = `${fmtTime(visit.scheduled_for)} · ${visit.patient_phone || ""}`.trim();

  // CTA conditionnel selon l'état : si déjà completed, on grise.
  const isDone = visit.status === "completed";

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView edges={["top"]}>
        <View style={styles.header}>
          <IconBtn name="chevronL" glyph={22} onPress={() => navigation.goBack()} />
          <View style={{ flex: 1, marginHorizontal: 12 }}>
            <Text style={[styles.headerKicker, { fontFamily: F.body || F.bodyBold }]}>
              RENDEZ-VOUS · {fmtTime(visit.scheduled_for)}
            </Text>
            <Text style={[styles.headerTitle, { fontFamily: F.displayBold || F.display }]} numberOfLines={1}>
              Détail mission
            </Text>
          </View>
          <StatusBadge status={visit.status} />
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}>
        {/* ── Patient ────────────────────────────────────────── */}
        <Card pad={14} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Avatar name={visit.patient_name || visit.patient_phone || "?"} size={54} color={C.brand} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.patName, { fontFamily: F.displayBold || F.display }]} numberOfLines={1}>
              {visit.patient_name || "—"}
            </Text>
            <Text style={[styles.patMeta, { fontFamily: F.body || F.bodyBold }]} numberOfLines={1}>
              {visit.patient_phone || "—"}
            </Text>
          </View>
          <IconBtn
            name="phone"
            glyph={18}
            size={46}
            bg={C.brandSoft}
            color={C.brandDeep}
            onPress={onCall}
          />
        </Card>

        {/* ── Adresse / itinéraire ────────────────────────────── */}
        <Card pad={12} style={{ marginTop: 12 }}>
          <View style={styles.addrTop}>
            <Icon name="pin" size={16} color={C.brand} />
            <Text style={[styles.addrLabel, { fontFamily: F.displayBold || F.display }]}>
              Adresse du prélèvement
            </Text>
          </View>
          <Text
            style={[styles.addrText, { fontFamily: F.body || F.bodyBold }]}
            numberOfLines={3}
          >
            {visit.home_address || "Adresse non renseignée"}
          </Text>
          {(visit.home_latitude && visit.home_longitude) ? (
            <View style={styles.gpsRow}>
              <Icon name="nav" size={13} color={C.inkSoft} />
              <Text style={[styles.gpsText, { fontFamily: F.body || F.bodyBold }]}>
                GPS {Number(visit.home_latitude).toFixed(4)} · {Number(visit.home_longitude).toFixed(4)}
              </Text>
            </View>
          ) : null}
          <View style={{ marginTop: 12 }}>
            <Btn icon="nav" variant="dark" size="md" onPress={onItinerary}>
              Itinéraire
            </Btn>
          </View>
        </Card>

        {/* ── Analyses à prélever ─────────────────────────────── */}
        <Text style={[styles.sectionKicker, { fontFamily: F.body || F.bodyBold }]}>
          ANALYSES À PRÉLEVER · {items.length}
        </Text>
        {items.length === 0 && (
          <Card pad={16} style={{ alignItems: "center" }}>
            <Icon name="vial" size={28} color={C.inkSoft} />
            <Text style={[styles.emptyTestsText, { fontFamily: F.body || F.bodyBold }]}>
              Aucun test rattaché à cette visite.
            </Text>
          </Card>
        )}
        {items.map((it, i) => {
          const cap = capColor(it.sample_type);
          return (
            <Card key={i} pad={12} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={[styles.tubeBox, { backgroundColor: hexA(cap, 0.12), borderColor: cap }]}>
                  <Icon name="vial" size={22} color={cap} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.testName, { fontFamily: F.displayBold || F.display }]} numberOfLines={1}>
                    {it.test_name || it.test_code}
                  </Text>
                  <Text style={[styles.testMeta, { fontFamily: F.body || F.bodyBold }]} numberOfLines={1}>
                    {it.test_code} · {it.sample_type || "—"}
                  </Text>
                </View>
                <Tag color={C.leaf} icon="check">1 tube</Tag>
              </View>
            </Card>
          );
        })}

        {/* ── Consignes / à jeun ──────────────────────────────── */}
        {(isFasting || visit.notes) && (
          <View style={styles.consignes}>
            <Icon name="alert" size={20} color={C.sun} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={[styles.consignesTitle, { fontFamily: F.displayBold || F.display }]}>
                {isFasting ? "Patient à jeun requis" : "Consignes"}
              </Text>
              <Text style={[styles.consignesText, { fontFamily: F.body || F.bodyBold }]}>
                {visit.notes
                  || (isFasting ? "Vérifier que le patient n'a rien consommé depuis au moins 8h." : "Aucune consigne particulière.")}
              </Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* CTA flottant */}
      <View style={styles.ctaWrap}>
        {isDone ? (
          <Btn variant="soft" icon="check" size="lg" full disabled>
            Visite terminée
          </Btn>
        ) : (
          <Btn variant="primary" icon="syringe" size="lg" full onPress={onStart}>
            Démarrer le prélèvement
          </Btn>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 6,
  },
  headerKicker: { fontSize: 11, color: C.inkSoft, letterSpacing: 0.6 },
  headerTitle:  { fontSize: 22, fontWeight: "700", color: C.ink, marginTop: 2 },

  patName: { fontSize: 18, fontWeight: "700", color: C.ink },
  patMeta: { fontSize: 13, color: C.inkSoft, marginTop: 2 },

  addrTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  addrLabel: { fontSize: 14, color: C.ink, fontWeight: "700" },
  addrText:  { fontSize: 14, color: C.inkSoft, marginTop: 6, lineHeight: 18 },
  gpsRow:    { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6 },
  gpsText:   { fontSize: 12, color: C.inkSoft },

  sectionKicker: { fontSize: 11, color: C.inkSoft, letterSpacing: 1.2, marginTop: 20, marginBottom: 8 },
  tubeBox: {
    width: 44, height: 44, borderRadius: 12,
    borderWidth: 1.5, alignItems: "center", justifyContent: "center",
  },
  testName: { fontSize: 15, fontWeight: "700", color: C.ink },
  testMeta: { fontSize: 12, color: C.inkSoft, marginTop: 2 },

  consignes: {
    flexDirection: "row", marginTop: 16,
    padding: 14, borderRadius: R.lg,
    backgroundColor: hexA(C.sun, 0.12),
    borderWidth: 1.5, borderColor: hexA(C.sun, 0.55),
  },
  consignesTitle: { fontSize: 15, color: C.ink, fontWeight: "700" },
  consignesText:  { fontSize: 13, color: C.inkSoft, marginTop: 4, lineHeight: 18 },

  ctaWrap: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingVertical: 14, paddingBottom: 24,
    backgroundColor: C.bg,
    borderTopWidth: 1, borderTopColor: C.hairSoft,
  },

  emptyTestsText: { fontSize: 13, color: C.inkSoft, marginTop: 10, textAlign: "center" },
  errTitle: { fontSize: 18, fontWeight: "700", color: C.ink, textAlign: "center" },
});

export default NurseMissionScreen;
