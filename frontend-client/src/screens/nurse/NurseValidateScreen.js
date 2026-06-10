// NurseValidateScreen — récap + signature + clôture du RDV.
//
// Reprend la maquette « Validation » du design Infirmier :
//   - récapitulatif (patient, préleveuse, heure, tubes prélevés)
//   - zone signature : on capture le tracé du doigt via PanResponder,
//     et on l'affiche en rendant chaque point comme un petit <View>
//     positionné en absolu. Pas de dépendance externe (react-native-svg
//     n'est pas dans le projet), ça reste léger pour quelques centaines
//     de points et c'est suffisant pour une signature de poche.
//   - bouton « Confirmer & déposer au labo » → completeVisit() puis
//     overlay « Prélèvement validé ! » + retour à la tournée.
//
// Effet de bord backend : completeVisit(uuid) → status=completed.
// Côté labo, les samples sont déjà reçus (cascade NurseCollect) donc
// les orders restent disponibles pour le technicien.
import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  PanResponder, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as api from "../../api";
import { useAuth } from "../../auth";
import { C, R, SHADOW, F } from "../../theme";
import { Btn, IconBtn, Card, hexA } from "../../components/UI";
import { Icon } from "../../icons";

// Échantillonne au plus 1 point tous les SAMPLE_STEP px pour éviter
// d'engorger le rendu ; au-delà on ne distingue plus rien à l'œil.
const SAMPLE_STEP = 2.5;

function NurseValidateScreen({ route, navigation }) {
  const { visitUuid } = route.params || {};
  const { user } = useAuth();

  const [visit, setVisit] = useState(null);
  const [loading, setLoading] = useState(true);
  // Liste plate de {x, y} pour tout le tracé (un Z-marqueur {pen:true}
  // sépare les segments distincts pour qu'on ne relie pas un nouveau
  // segment au précédent — utile si l'utilisateur lève le doigt).
  const [pts, setPts] = useState([]);
  const lastRef = useRef(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const v = await api.fetchAppointment(visitUuid);
      setVisit(v);
    } catch (e) {
      Alert.alert("Erreur", e?.detail || "Visite introuvable.");
      navigation.goBack();
    } finally { setLoading(false); }
  }, [visitUuid, navigation]);
  useEffect(() => { load(); }, [load]);

  const pushPoint = (x, y) => {
    const last = lastRef.current;
    if (last && Math.hypot(x - last.x, y - last.y) < SAMPLE_STEP) return;
    lastRef.current = { x, y };
    setPts((arr) => [...arr, { x, y }]);
  };

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !sent,
    onMoveShouldSetPanResponder: () => !sent,
    onPanResponderGrant: (e) => {
      const { locationX, locationY } = e.nativeEvent;
      lastRef.current = null;
      pushPoint(locationX, locationY);
    },
    onPanResponderMove: (e) => {
      const { locationX, locationY } = e.nativeEvent;
      pushPoint(locationX, locationY);
    },
    onPanResponderRelease: () => { lastRef.current = null; },
    onPanResponderTerminate: () => { lastRef.current = null; },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [sent]);

  const signed = pts.length > 6;   // seuil mini pour éviter un simple tap.
  const clearSig = () => { setPts([]); lastRef.current = null; };

  const onConfirm = async () => {
    if (!signed) return;
    setSending(true);
    try {
      await api.completeVisit(visitUuid);
      setSent(true);
      setTimeout(() => {
        // Reset à la racine de la stack — l'utilisateur revient sur la
        // tournée, pas sur l'écran de signature.
        navigation.popToTop();
      }, 1100);
    } catch (e) {
      Alert.alert("Erreur", e?.detail || "Validation refusée.");
      setSending(false);
    }
  };

  if (loading || !visit) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: "center" }}>
        <ActivityIndicator color={C.brand} />
      </View>
    );
  }

  const nurseName = (user?.first_name || user?.last_name)
    ? `${user.first_name || ""} ${user.last_name || ""}`.trim()
    : (user?.phone || "—");

  const tubesLabel = (visit.items || [])
    .map((it) => it.test_code)
    .filter(Boolean)
    .join(", ") || "—";

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView edges={["top"]}>
        <View style={styles.header}>
          <IconBtn name="chevronL" glyph={22} onPress={() => navigation.goBack()} />
          <Text style={[styles.title, { fontFamily: F.displayBold || F.display }]}>
            Validation
          </Text>
          <View style={{ width: 44 }} />
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}>
        {/* Récapitulatif */}
        <Card pad={14}>
          <View style={styles.recapHead}>
            <Icon name="check" size={18} color={C.leaf} />
            <Text style={[styles.recapTitle, { fontFamily: F.displayBold || F.display }]}>
              Récapitulatif
            </Text>
          </View>
          <RecapRow label="Patient"        value={visit.patient_name || "—"} />
          <RecapRow label="Préleveuse"     value={nurseName} />
          <RecapRow label="Heure"          value={`Aujourd'hui · ${fmtTime(visit.scheduled_for)}`} />
          <RecapRow label="Tubes prélevés" value={`${(visit.items || []).length} · ${tubesLabel}`} />
        </Card>

        {/* Signature */}
        <Text style={[styles.kicker, { fontFamily: F.body || F.bodyBold }]}>
          SIGNATURE DU PATIENT
        </Text>
        <View
          style={styles.sigCard}
          {...pan.panHandlers}
          // Bloque le scroll parent pendant qu'on dessine (sinon le
          // ScrollView intercepte le geste vertical).
          onStartShouldSetResponder={() => true}
        >
          {/* Rendu : un petit cercle pour chaque point échantillonné. */}
          {pts.map((p, i) => (
            <View
              key={i}
              pointerEvents="none"
              style={[
                styles.sigDot,
                { left: p.x - 1.4, top: p.y - 1.4 },
              ]}
            />
          ))}
          {pts.length === 0 && (
            <View style={{ alignItems: "center" }} pointerEvents="none">
              <Text style={[styles.sigHint, { fontFamily: F.displayBold || F.display }]}>
                Signez ici
              </Text>
              <Text style={[styles.sigSub, { fontFamily: F.body || F.bodyBold }]}>
                Tracez la signature avec le doigt
              </Text>
            </View>
          )}
          {signed && (
            <View style={styles.sigDoneBadge} pointerEvents="none">
              <Icon name="check" size={12} color={C.leaf} />
              <Text style={styles.sigDoneText}>Signé</Text>
            </View>
          )}
        </View>
        {pts.length > 0 && (
          <Btn variant="ghost" size="sm" onPress={clearSig} style={{ marginTop: 8, alignSelf: "flex-start" }}>
            Effacer
          </Btn>
        )}

        {/* Horodatage */}
        <View style={styles.timestamp}>
          <Icon name="clock" size={15} color={C.inkSoft} />
          <Text style={[styles.timestampText, { fontFamily: F.body || F.bodyBold }]}>
            Horodaté à {new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            {visit.home_address ? ` · ${visit.home_address.split(",")[0]}` : ""}
          </Text>
        </View>
      </ScrollView>

      {/* CTA */}
      <View style={styles.ctaWrap}>
        <View style={{ opacity: signed && !sending ? 1 : 0.45 }}>
          <Btn
            variant="primary"
            icon={sent ? "check" : undefined}
            size="lg"
            full
            onPress={signed && !sending ? onConfirm : undefined}
            disabled={!signed || sending}
            loading={sending && !sent}
          >
            {sent ? "Envoyé" : "Confirmer & déposer au labo"}
          </Btn>
        </View>
      </View>

      {/* Overlay de succès */}
      {sent && (
        <View style={styles.successOverlay} pointerEvents="none">
          <View style={styles.successCard}>
            <View style={styles.successCheck}>
              <Icon name="check" size={32} color={C.leaf} />
            </View>
            <Text style={[styles.successTitle, { fontFamily: F.displayBold || F.display }]}>
              Prélèvement validé !
            </Text>
            <Text style={[styles.successSub, { fontFamily: F.body || F.bodyBold }]}>
              Transmis au laboratoire. Retour à la tournée…
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

function RecapRow({ label, value }) {
  return (
    <View style={styles.recapRow}>
      <Text style={[styles.recapLabel, { fontFamily: F.body || F.bodyBold }]}>{label}</Text>
      <Text
        style={[styles.recapValue, { fontFamily: F.displayBold || F.display }]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("fr-FR", {
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 6,
  },
  title: { flex: 1, fontSize: 22, fontWeight: "700", color: C.ink, textAlign: "center" },

  recapHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  recapTitle: { fontSize: 16, color: C.ink, fontWeight: "700" },
  recapRow: {
    flexDirection: "row", justifyContent: "space-between",
    paddingVertical: 5, gap: 14,
  },
  recapLabel: { fontSize: 13, color: C.inkSoft },
  recapValue: { fontSize: 13, color: C.ink, fontWeight: "700", textAlign: "right", flex: 1 },

  kicker: { fontSize: 11, color: C.inkSoft, letterSpacing: 1.2, marginTop: 18, marginBottom: 8 },

  sigCard: {
    height: 160, borderRadius: R.lg, borderWidth: 1.5, borderColor: C.hair,
    backgroundColor: "#fff", alignItems: "center", justifyContent: "center",
    overflow: "hidden", ...SHADOW.sm,
  },
  sigHint: { fontSize: 20, color: C.inkSoft, fontWeight: "700" },
  sigSub:  { fontSize: 12, color: C.inkSoft, marginTop: 2 },
  sigDot: {
    position: "absolute",
    width: 2.8, height: 2.8, borderRadius: 999,
    backgroundColor: C.brandDeep,
  },
  sigDoneBadge: {
    position: "absolute", bottom: 8, right: 10,
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999,
    backgroundColor: hexA(C.leaf, 0.16),
  },
  sigDoneText: { fontSize: 11, fontWeight: "700", color: C.leaf },

  timestamp: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 16 },
  timestampText: { fontSize: 12, color: C.inkSoft },

  ctaWrap: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingVertical: 14, paddingBottom: 24,
    backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.hairSoft,
  },

  successOverlay: {
    position: "absolute", inset: 0,
    backgroundColor: "rgba(20, 57, 66, 0.45)",
    alignItems: "center", justifyContent: "center",
  },
  successCard: {
    width: 260, padding: 22, borderRadius: R.xl,
    backgroundColor: "#fff", alignItems: "center", ...SHADOW.md,
  },
  successCheck: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: hexA(C.leaf, 0.16),
    alignItems: "center", justifyContent: "center",
    marginBottom: 12,
  },
  successTitle: { fontSize: 20, fontWeight: "700", color: C.ink, textAlign: "center" },
  successSub:   { fontSize: 13, color: C.inkSoft, marginTop: 4, textAlign: "center", lineHeight: 18 },
});

export default NurseValidateScreen;
