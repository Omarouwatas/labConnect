// NurseCollectScreen — check-list de prélèvement guidé.
//
// Reprend la maquette « Prélèvement » du design Infirmier :
//   - barre de progression haut (Identité + tubes cochés / total)
//   - étape 1 : vérifier l'identité du patient (carte cochable)
//   - étape 2 : pour chaque test → tube cochable avec code barre généré
//   - CTA bas activé seulement quand tout est coché → push NurseValidate
//
// Effets de bord backend :
//   - à l'ouverture, on appelle startVisit(uuid) UNE FOIS si le RDV est
//     encore en pending / confirmed / checked_in. Ça déclenche la cascade
//     côté backend (samples reçus, orders en in_progress).
//   - on n'avance pas le statut à la sortie : c'est NurseValidate qui
//     finalise (completed) après signature.
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as api from "../../api";
import { C, R, SHADOW, F } from "../../theme";
import { Btn, IconBtn, Card, hexA } from "../../components/UI";
import { Icon } from "../../icons";

function NurseCollectScreen({ route, navigation }) {
  const { visitUuid } = route.params || {};
  const [visit, setVisit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [idOk, setIdOk] = useState(false);
  // `tubes[i].done` = tube validé/prélevé ; `tubes[i].barcode` = code
  // saisi par l'infirmière (manuellement ou via scan). On garde le tout
  // dans une seule structure pour simplifier le rendu et la validation.
  const [tubes, setTubes] = useState([]);
  const startedRef = useRef(false);
  const [savingTubes, setSavingTubes] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const v = await api.fetchAppointment(visitUuid);
      setVisit(v);
      // On pré-remplit avec les éventuels codes déjà saisis (cas où l'on
      // revient sur l'écran après navigation arrière). Le backend nous
      // renvoie `tube_barcode` dans `items` quand il est défini.
      setTubes((v.items || []).map((it) => ({
        done: !!it.tube_barcode,
        barcode: it.tube_barcode || "",
      })));
    } catch (e) {
      Alert.alert("Erreur", e?.detail || "Visite introuvable.");
      navigation.goBack();
    } finally { setLoading(false); }
  }, [visitUuid, navigation]);
  useEffect(() => { load(); }, [load]);

  // Démarre la visite côté backend une seule fois — la cascade :
  //   appt.status      pending → in_progress
  //   sample.status    pending → received
  //   testorder.status pending → in_progress
  // Si le RDV est déjà in_progress / completed, on ne fait rien.
  useEffect(() => {
    if (!visit || startedRef.current) return;
    if (visit.status === "in_progress" || visit.status === "completed") return;
    startedRef.current = true;
    api.startVisit(visit.uuid).catch(() => {
      // Si le serveur refuse (2FA manquant côté staff par exemple), on
      // n'empêche pas la check-list de continuer — le statut sera
      // poussé à la prochaine action utilisateur.
      startedRef.current = false;
    });
  }, [visit]);

  const items = useMemo(() => visit?.items || [], [visit]);

  const toggleDone = (i) => setTubes((a) => a.map((x, j) =>
    j === i ? { ...x, done: !x.done } : x));
  const setBarcode = (i, barcode) => setTubes((a) => a.map((x, j) =>
    j === i ? { ...x, barcode } : x));

  // Un tube est « complet » s'il a été coché ET qu'un code-barre est saisi
  // (au moins 3 caractères pour éviter une frappe accidentelle).
  const tubeComplete = (t) => t.done && (t.barcode || "").trim().length >= 3;
  const filled = tubes.filter(tubeComplete).length;
  const steps = 1 + items.length;                // identitovigilance + 1 par test
  const progress = (idOk ? 1 : 0) + filled;
  const allDone = idOk && filled === items.length && items.length > 0;

  const onValidate = async () => {
    // On envoie le batch de tubes au backend AVANT de naviguer vers la
    // signature, pour que le PDF ait l'info même si l'utilisateur ferme
    // l'app entre ici et la validation.
    setSavingTubes(true);
    try {
      const map = {};
      items.forEach((it, i) => {
        if (it.order_uuid && tubeComplete(tubes[i])) {
          map[it.order_uuid] = tubes[i].barcode.trim();
        }
      });
      if (Object.keys(map).length > 0) {
        await api.saveTubes(visitUuid, map);
      }
      navigation.navigate("NurseValidate", { visitUuid });
    } catch (e) {
      Alert.alert(
        "Tubes",
        e?.detail || "Impossible d'enregistrer les codes-barres. Réessayez.",
      );
    } finally { setSavingTubes(false); }
  };

  if (loading || !visit) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: "center" }}>
        <ActivityIndicator color={C.brand} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView edges={["top"]}>
        <View style={styles.header}>
          <IconBtn name="chevronL" glyph={22} onPress={() => navigation.goBack()} />
          <View style={{ flex: 1, marginHorizontal: 12 }}>
            <Text style={[styles.kicker, { fontFamily: F.body || F.bodyBold }]} numberOfLines={1}>
              {visit.patient_name || "—"} · {fmtTime(visit.scheduled_for)}
            </Text>
            <Text style={[styles.title, { fontFamily: F.displayBold || F.display }]}>
              Prélèvement
            </Text>
          </View>
        </View>

        {/* Barre de progression */}
        <View style={styles.progRow}>
          <View style={styles.progTrack}>
            <View style={[styles.progFill, { width: `${(progress / steps) * 100}%` }]} />
          </View>
          <Text style={[styles.progLabel, { fontFamily: F.displayBold || F.display }]}>
            {progress}/{steps}
          </Text>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}>
        {/* Étape 1 — Identitovigilance */}
        <Text style={[styles.stepKicker, { fontFamily: F.body || F.bodyBold }]}>
          ÉTAPE 1 · IDENTITOVIGILANCE
        </Text>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => setIdOk((v) => !v)}
          style={[
            styles.checkCard,
            idOk && { backgroundColor: hexA(C.leaf, 0.10), borderColor: C.leaf },
          ]}
        >
          <Icon
            name="user"
            size={26}
            color={idOk ? C.leaf : C.ink}
          />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[styles.checkTitle, { fontFamily: F.displayBold || F.display }]}>
              Vérifier l'identité
            </Text>
            <Text style={[styles.checkSub, { fontFamily: F.body || F.bodyBold }]} numberOfLines={2}>
              Nom, prénom et date de naissance confirmés
            </Text>
          </View>
          <Checkbox on={idOk} />
        </TouchableOpacity>

        {/* Étape 2 — Étiquetage & prélèvement */}
        <Text style={[styles.stepKicker, { fontFamily: F.body || F.bodyBold, marginTop: 22 }]}>
          ÉTAPE 2 · ÉTIQUETER &amp; PRÉLEVER
        </Text>
        {items.map((it, i) => {
          const t = tubes[i] || { done: false, barcode: "" };
          const complete = tubeComplete(t);
          const cap = sampleCap(it.sample_type);
          // Code suggéré pour étiquette physique du tube — l'infirmière
          // peut l'utiliser tel quel ou scanner un autre code (un code
          // labo pré-imprimé), c'est l'input texte qui fait foi.
          const suggestion = `${(visit.uuid || "").slice(0, 4).toUpperCase()}-${(it.test_code || "").slice(0, 3).toUpperCase()}`;
          return (
            <View
              key={i}
              style={[
                styles.checkCard,
                { marginTop: 10, flexDirection: "column", alignItems: "stretch" },
                complete && { backgroundColor: hexA(C.brand, 0.10), borderColor: C.brand },
              ]}
            >
              {/* Header row — type tube + nom test + checkbox done */}
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => toggleDone(i)}
                style={{ flexDirection: "row", alignItems: "center" }}
              >
                <View style={[styles.tubeBox, { backgroundColor: hexA(cap, 0.16), borderColor: cap }]}>
                  <Icon name="vial" size={26} color={cap} />
                </View>
                <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
                  <Text style={[styles.checkTitle, { fontFamily: F.displayBold || F.display }]} numberOfLines={1}>
                    {it.test_name || it.test_code}
                  </Text>
                  <Text style={[styles.checkSub, { fontFamily: F.body || F.bodyBold }]}>
                    {it.test_code} · {it.sample_type || "—"}
                  </Text>
                </View>
                <Checkbox on={t.done} />
              </TouchableOpacity>

              {/* Input code-barre du tube — toujours visible mais cap
                  visuel quand le test est validé. On insère un petit
                  bouton « copier suggestion » pour la saisie rapide. */}
              <View style={styles.barcodeRow}>
                <View style={[
                  styles.barcodeInputWrap,
                  complete && { borderColor: C.brand, backgroundColor: "#fff" },
                ]}>
                  <Icon name="vial" size={14} color={C.inkSoft} />
                  <TextInput
                    value={t.barcode}
                    onChangeText={(v) => setBarcode(i, v)}
                    placeholder={`N° tube · ex ${suggestion}`}
                    placeholderTextColor={C.inkSoft}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={32}
                    style={[
                      styles.barcodeInput,
                      { fontFamily: F.bodyBold || F.body },
                    ]}
                  />
                  {(t.barcode || "").length > 0 ? (
                    <TouchableOpacity onPress={() => setBarcode(i, "")} hitSlop={8}>
                      <Icon name="close" size={14} color={C.inkSoft} />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      onPress={() => setBarcode(i, suggestion)}
                      hitSlop={8}
                    >
                      <Text style={[styles.barcodeUseSuggestion, { fontFamily: F.bodyBold || F.body }]}>
                        UTILISER
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>
          );
        })}
        {items.length === 0 && (
          <Card pad={16} style={{ alignItems: "center", marginTop: 8 }}>
            <Icon name="info" size={26} color={C.inkSoft} />
            <Text style={[styles.emptyText, { fontFamily: F.body || F.bodyBold }]}>
              Aucun test à prélever pour ce RDV.
            </Text>
          </Card>
        )}

        <Text style={[styles.hint, { fontFamily: F.body || F.bodyBold }]}>
          Touche chaque tube une fois étiqueté et prélevé.
        </Text>
      </ScrollView>

      <View style={styles.ctaWrap}>
        <View style={{ opacity: allDone && !savingTubes ? 1 : 0.45 }}>
          <Btn
            variant="primary"
            iconR={savingTubes ? undefined : "chevronR"}
            size="lg"
            full
            loading={savingTubes}
            onPress={allDone && !savingTubes ? onValidate : undefined}
            disabled={!allDone || savingTubes}
          >
            Valider le prélèvement
          </Btn>
        </View>
        {!allDone && (
          <Text style={[styles.hintCenter, { fontFamily: F.body || F.bodyBold }]}>
            Coche chaque tube ET saisis son code-barre pour continuer
          </Text>
        )}
      </View>
    </View>
  );
}

function Checkbox({ on }) {
  return (
    <View
      style={[
        styles.cbBox,
        { backgroundColor: on ? C.brand : "#fff", borderColor: on ? C.brand : C.hair },
      ]}
    >
      {on && <Icon name="check" size={18} color="#fff" />}
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

// Map sample_type → couleur de bouchon (cohérent avec NurseMissionScreen).
function sampleCap(t) {
  switch ((t || "").toLowerCase()) {
    case "blood":  return C.coral;
    case "urine":  return C.sun;
    case "stool":  return C.leaf;
    case "saliva": return C.brand;
    case "swab":   return C.grape;
    default:       return C.grape;
  }
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 6,
  },
  kicker: { fontSize: 12, color: C.inkSoft },
  title:  { fontSize: 22, fontWeight: "700", color: C.ink, marginTop: 2 },

  progRow:  { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingBottom: 10 },
  progTrack: {
    flex: 1, height: 10, borderRadius: 7,
    backgroundColor: hexA(C.brand, 0.10),
    borderWidth: 1.4, borderColor: hexA(C.brand, 0.30),
    overflow: "hidden",
  },
  progFill: { height: "100%", backgroundColor: C.brand },
  progLabel: { fontSize: 14, fontWeight: "700", color: C.ink, minWidth: 36, textAlign: "right" },

  stepKicker: { fontSize: 11, color: C.inkSoft, letterSpacing: 1.2, marginTop: 4, marginBottom: 8 },

  checkCard: {
    flexDirection: "row", alignItems: "center",
    padding: 13, borderRadius: R.lg,
    backgroundColor: "#fff",
    borderWidth: 1.5, borderColor: C.hair,
    ...SHADOW.sm,
  },
  checkTitle: { fontSize: 15, fontWeight: "700", color: C.ink },
  checkSub:   { fontSize: 12, color: C.inkSoft, marginTop: 3 },

  metaRow: {
    flexDirection: "row", alignItems: "center", gap: 8, marginTop: 3, flexWrap: "wrap",
  },
  tubeLabelChip: {
    backgroundColor: C.bgElev,
    borderColor: C.hair, borderWidth: 1,
    paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6,
  },
  tubeLabelText: { fontSize: 10.5, fontWeight: "700", color: C.ink, letterSpacing: 0.3 },

  // Input code-barre du tube (sous le header de chaque test).
  barcodeRow: { marginTop: 10 },
  barcodeInputWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1.2, borderColor: C.hair,
    backgroundColor: C.bgElev,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
  },
  barcodeInput: {
    flex: 1, fontSize: 14, color: C.ink, letterSpacing: 0.6,
    paddingVertical: 0,
  },
  barcodeUseSuggestion: {
    fontSize: 11, fontWeight: "800", color: C.brand, letterSpacing: 0.4,
  },

  tubeBox: {
    width: 46, height: 46, borderRadius: 12,
    borderWidth: 1.5, alignItems: "center", justifyContent: "center",
  },

  cbBox: {
    width: 30, height: 30, borderRadius: 9,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.8,
  },

  hint:       { fontSize: 12, color: C.inkSoft, textAlign: "center", marginTop: 16, lineHeight: 18 },
  hintCenter: { fontSize: 12, color: C.inkSoft, textAlign: "center", marginTop: 6 },

  ctaWrap: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingVertical: 14, paddingBottom: 24,
    backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.hairSoft,
  },

  emptyText: { fontSize: 13, color: C.inkSoft, marginTop: 8, textAlign: "center" },
});

export default NurseCollectScreen;
