// CartScreen — Réservation + écran de confirmation animé.
// Refonte d'après le design Anthropic : lieu (labo/domicile), strip de
// dates, grille de créneaux, toggle CNAM avec breakdown détaillé, et
// après confirmation un écran ✓ avec confetti et récap.
//
// Côté backend on garde TOUT le contrat existant : POST /appointments/
// avec test_uuids + prerequisite_answers + cnam_used. La création
// atomique Appointment + Sample + TestOrders est gérée côté serveur.
import React, { useMemo, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, TextInput, Switch, Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CommonActions } from "@react-navigation/native";
import * as api from "../api";
import { useAuth } from "../auth";
import { C, R, SHADOW, F, CURRENCY, labColor, labIcon } from "../theme";
import { Btn, IconBtn, Card, Tag, StatusBadge, Divider, hexA } from "../components/UI";
import { Icon } from "../icons";

// 6 prochains jours, label court
function nextDays(count = 6) {
  const out = [];
  const LABELS = ["Auj.", "Demain"];
  const DOW = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const lab = i < LABELS.length ? LABELS[i] : DOW[d.getDay()];
    out.push({
      key: d.toISOString().slice(0, 10),
      label: lab,
      num: String(d.getDate()),
      date: d,
    });
  }
  return out;
}
const SLOTS = ["08:00", "08:30", "09:00", "09:30", "10:00", "11:00", "14:00", "15:30"];

export default function CartScreen({ route, navigation }) {
  const { lab, tests, mode: mode0 = "labo" } = route.params;
  const { user } = useAuth();

  const days = useMemo(() => nextDays(6), []);
  const [mode, setMode] = useState(mode0);
  const [dayKey, setDayKey] = useState(days[1]?.key || days[0].key);
  const [slot, setSlot] = useState("08:30");
  const [cnam, setCnam] = useState(!!lab.accepts_cnam);
  const [homeAddress, setHomeAddress] = useState(user?.home_address || "");
  // Réponses au questionnaire pré-test, indexées par test_uuid → liste alignée.
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Tests avec questions — on affiche un bloc questionnaire dédié.
  const testsWithQuestions = useMemo(
    () => tests.filter((t) => (t.prerequisite_questions || []).length > 0),
    [tests],
  );
  const setAnswer = (uuid, idx, val) => setAnswers((a) => {
    const cur = a[uuid] || [];
    const next = [...cur];
    next[idx] = val;
    return { ...a, [uuid]: next };
  });

  // Calculs CNAM
  const subTests = tests.reduce((s, t) => s + Number(t.price_mru || 0), 0);
  const fee = mode === "domicile" ? Number(lab.home_visit_fee_mru || 500) : 0;
  const subtotal = subTests + fee;
  // 80% sur les tests éligibles si le patient utilise sa CNAM
  const eligibleTotal = tests
    .filter((t) => t.cnam_eligible ?? true)
    .reduce((s, t) => s + Number(t.price_mru || 0), 0);
  const covered = cnam ? Math.round(eligibleTotal * 0.8) : 0;
  const reste = subtotal - covered;

  const dayObj = days.find((d) => d.key === dayKey);

  const confirm = async () => {
    if (mode === "domicile" && !homeAddress.trim()) {
      return Alert.alert("Adresse requise", "Indiquez l'adresse de prélèvement à domicile.");
    }
    setSubmitting(true);
    try {
      // Construit le datetime ISO depuis dayObj + slot
      const [h, m] = slot.split(":").map(Number);
      const d = new Date(dayObj.date);
      d.setHours(h, m, 0, 0);

      // Filtre réponses non vides
      const answersPayload = {};
      for (const t of testsWithQuestions) {
        const arr = answers[t.uuid] || [];
        if (arr.some((v) => v && v.trim())) answersPayload[t.uuid] = arr;
      }

      await api.createAppointment({
        laboratoryUuid: lab.uuid,
        visitType: mode === "domicile" ? "home" : "in_lab",
        scheduledFor: d.toISOString(),
        homeAddress: mode === "domicile" ? homeAddress : "",
        notes: `Tests : ${tests.map((t) => t.code).join(", ")}`,
        testUuids: tests.map((t) => t.uuid),
        prerequisiteAnswers: answersPayload,
        // Hint backend pour qu'il applique (ou pas) le pourcentage CNAM
        // — l'arithmétique finale reste côté serveur.
        cnamUsed: cnam,
      });

      setSuccess(true);
    } catch (e) {
      const raw = e?.raw;
      const fieldErrs = raw && typeof raw === "object" && !raw.error
        ? Object.entries(raw)
            .map(([k, v]) => `${k} : ${Array.isArray(v) ? v.join(" ") : v}`)
            .join("\n")
        : null;
      Alert.alert("Erreur", fieldErrs || e?.detail || "Impossible de créer le rendez-vous.");
    } finally { setSubmitting(false); }
  };

  // ── Écran de succès inline ──────────────────────────────────────────
  if (success) {
    return <SuccessView
      lab={lab}
      tests={tests}
      mode={mode}
      dayObj={dayObj}
      slot={slot}
      reste={reste}
      cnam={cnam}
      covered={covered}
      navigation={navigation}
    />;
  }

  // ── Écran principal ─────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView edges={["top"]} style={styles.headerWrap}>
        <View style={styles.header}>
          <IconBtn name="chevronL" glyph={24} bg={C.bg} shadow={false} onPress={() => navigation.goBack()} />
          <Text style={styles.headerTitle}>Réservation</Text>
          <View style={{ width: 44 }} />
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 140 }}>
        {/* Récap labo + nb analyses */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <View style={[styles.recapLogo, { backgroundColor: hexA(labColor(lab.uuid), 0.16) }]}>
            <Icon name={labIcon(lab.uuid)} size={26} color={labColor(lab.uuid)} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.recapLab}>{lab.name}</Text>
            <Text style={styles.recapMeta}>
              {tests.length} analyse{tests.length > 1 ? "s" : ""} · {CURRENCY.format(subTests)}
            </Text>
          </View>
        </View>

        {/* Lieu */}
        <Text style={styles.sectLabel}>Lieu du prélèvement</Text>
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 22 }}>
          {[
            { id: "labo",     icon: "hospital", label: "Au laboratoire", sub: lab.city || "Nouakchott", available: true },
            { id: "domicile", icon: "house2",   label: "À domicile",     sub: user?.home_address || "Renseignez l'adresse", available: !!lab.accepts_home_visits },
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
                <Icon name={m.icon} size={20} color={on ? C.brand : C.ink} />
                <Text style={[styles.modeLabel, on && { color: C.brandDeep }]}>{m.label}</Text>
                <Text style={styles.modeSub} numberOfLines={1}>{m.sub}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Adresse domicile */}
        {mode === "domicile" && (
          <>
            <Text style={styles.sectLabel}>Adresse de prélèvement</Text>
            <TextInput
              value={homeAddress}
              onChangeText={setHomeAddress}
              placeholder="Quartier, rue, repère…"
              placeholderTextColor={C.inkSoft}
              style={styles.addressInput}
              multiline
            />
          </>
        )}

        {/* Date */}
        <Text style={styles.sectLabel}>Choisir une date</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginBottom: 22 }}
          contentContainerStyle={{ gap: 9 }}
        >
          {days.map((d) => {
            const on = dayKey === d.key;
            return (
              <Pressable
                key={d.key}
                onPress={() => setDayKey(d.key)}
                style={({ pressed }) => [
                  styles.dayBtn,
                  on && { backgroundColor: C.brand, ...SHADOW.brand },
                  pressed && { transform: [{ scale: 0.97 }] },
                ]}
              >
                <Text style={[styles.dayLabel, on && { color: "rgba(255,255,255,0.85)" }]}>{d.label}</Text>
                <Text style={[styles.dayNum, on && { color: "#fff" }]}>{d.num}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Créneaux */}
        <Text style={styles.sectLabel}>Créneaux disponibles</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9, marginBottom: 22 }}>
          {SLOTS.map((s) => {
            const on = slot === s;
            return (
              <TouchableOpacity
                key={s}
                onPress={() => setSlot(s)}
                activeOpacity={0.85}
                style={[
                  styles.slotBtn,
                  on
                    ? { backgroundColor: C.brand }
                    : { backgroundColor: "#fff", borderWidth: 1.5, borderColor: C.hair },
                ]}
              >
                <Text style={[styles.slotText, on && { color: "#fff" }]}>{s}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Questionnaire pré-test (par test concerné) */}
        {testsWithQuestions.length > 0 && (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 12 }}>
              <Icon name="document" size={18} color={C.ink} />
              <Text style={[styles.sectLabel, { marginBottom: 0 }]}>Questionnaire pré-test</Text>
            </View>
            <Card pad={14} style={{ marginBottom: 22 }}>
              <Text style={styles.qHelp}>
                Vos réponses sont transmises au biologiste avec le prélèvement.
              </Text>
              {testsWithQuestions.map((t) => (
                <View key={t.uuid} style={styles.qBlock}>
                  <Text style={styles.qTestHead}>
                    {t.code} <Text style={{ color: C.inkSoft, fontWeight: "600" }}>· {t.name}</Text>
                  </Text>
                  {(t.prerequisite_questions || []).map((q, i) => (
                    <View key={i} style={{ marginTop: 8 }}>
                      <Text style={styles.qLabel}>{q}</Text>
                      <TextInput
                        style={styles.qInput}
                        value={(answers[t.uuid] || [])[i] || ""}
                        onChangeText={(val) => setAnswer(t.uuid, i, val)}
                        placeholder="Réponse…"
                        placeholderTextColor={C.inkSoft}
                      />
                    </View>
                  ))}
                </View>
              ))}
            </Card>
          </>
        )}

        {/* CNAM + breakdown */}
        <Text style={styles.sectLabel}>Prise en charge CNAM</Text>
        <Card pad={16} style={{ marginBottom: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={[styles.cnamIcon, { backgroundColor: hexA(C.leaf, 0.16) }]}>
              <Icon name="shieldFill" size={22} color={C.leaf} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cnamTitle}>J'utilise ma carte CNAM</Text>
              <Text style={styles.cnamSub}>80% sur les analyses éligibles</Text>
            </View>
            <Switch
              value={cnam}
              onValueChange={setCnam}
              trackColor={{ true: C.leaf, false: C.hair }}
              thumbColor="#fff"
            />
          </View>

          <Divider style={{ marginVertical: 14 }} />

          <Row label="Sous-total analyses" val={CURRENCY.format(subTests)} />
          {fee > 0 && <Row label="Frais déplacement à domicile" val={CURRENCY.format(fee)} />}
          {cnam && <Row label="CNAM (−80% éligible)" val={`− ${CURRENCY.format(covered)}`} green />}

          <Divider style={{ marginVertical: 12 }} />

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: C.ink }}>Reste à charge</Text>
            <Text style={{ fontSize: 26, fontWeight: "700", color: C.brandDeep }}>
              {CURRENCY.format(reste)}
            </Text>
          </View>
        </Card>
      </ScrollView>

      {/* CTA */}
      <View style={styles.footer}>
        <Btn full size="lg" iconR="check" loading={submitting} onPress={confirm}>
          Confirmer le rendez-vous
        </Btn>
      </View>
    </View>
  );
}

// ── Row helper (label / valeur, optionnel green) ────────────────────────
function Row({ label, val, green }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5 }}>
      <Text style={{ fontWeight: "700", fontSize: 13.5, color: C.inkSoft }}>{label}</Text>
      <Text style={{ fontWeight: "700", fontSize: 14.5, color: green ? C.leaf : C.ink }}>{val}</Text>
    </View>
  );
}

// ── Écran de succès animé ──────────────────────────────────────────────
function SuccessView({ lab, tests, mode, dayObj, slot, reste, cnam, covered, navigation }) {
  const goBookings = () => navigation.dispatch(
    CommonActions.reset({
      index: 0,
      routes: [{
        name: "Main",
        state: { index: 1, routes: [{ name: "HomeTab" }, { name: "BookingsTab" }] },
      }],
    }),
  );
  const goHome = () => navigation.dispatch(
    CommonActions.reset({ index: 0, routes: [{ name: "Main" }] }),
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ alignItems: "center", padding: 24, paddingBottom: 24 }}>
          {/* Confetti static (5 dots colorés) */}
          <View style={{ marginTop: 30, marginBottom: 24, position: "relative" }}>
            {[
              { c: C.brand, x: -46, y: -10 },
              { c: C.sun,   x:  60, y:   0 },
              { c: C.coral, x: -64, y:  64 },
              { c: C.grape, x:  70, y:  60 },
              { c: C.leaf,  x:  10, y: -40 },
            ].map((d, i) => (
              <View key={i} style={{
                position: "absolute",
                left: 58 + d.x, top: 58 + d.y,
                width: i % 2 ? 9 : 12, height: i % 2 ? 9 : 12,
                borderRadius: i % 3 ? 999 : 3,
                backgroundColor: d.c,
              }} />
            ))}
            <View style={[styles.checkCircle, { backgroundColor: C.leaf, ...SHADOW.sm }]}>
              <Icon name="check" size={62} color="#fff" />
            </View>
          </View>

          <Text style={styles.confirmTitle}>Rendez-vous confirmé !</Text>
          <Text style={styles.confirmSub}>
            {mode === "domicile"
              ? "Un infirmier passera chez vous. "
              : "Présentez-vous au laboratoire. "}
            Un rappel vous sera envoyé.
          </Text>

          {/* Recap card */}
          <Card pad={18} style={{ alignSelf: "stretch", marginTop: 20 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 14 }}>
              <View style={[styles.recapLogo, { backgroundColor: hexA(labColor(lab.uuid), 0.16) }]}>
                <Icon name={labIcon(lab.uuid)} size={24} color={labColor(lab.uuid)} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.recapLab}>{lab.name}</Text>
                <View style={{ marginTop: 6, alignSelf: "flex-start" }}>
                  <StatusBadge status="confirmed" />
                </View>
              </View>
            </View>
            <Divider dashed />

            <RecapRow icon="calendar" label="DATE & HEURE" val={`${dayObj?.label || ""} ${dayObj?.num || ""} · ${slot}`} />
            <RecapRow
              icon={mode === "domicile" ? "house2" : "pin"}
              label="LIEU"
              val={mode === "domicile" ? "À domicile" : lab.name}
            />
            <RecapRow
              icon="vial"
              label="ANALYSES"
              val={tests.map((t) => t.name.split(" (")[0]).join(", ")}
            />
            {cnam && (
              <RecapRow
                icon="shield"
                label="CNAM"
                val={`− ${CURRENCY.format(covered)} pris en charge`}
                green
              />
            )}

            <View style={styles.totalPill}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: C.ink }}>Reste à charge</Text>
              <Text style={{ fontSize: 22, fontWeight: "700", color: C.brandDeep }}>
                {CURRENCY.format(reste)}
              </Text>
            </View>
          </Card>
        </ScrollView>

        <View style={{ padding: 24, gap: 10 }}>
          <Btn full size="lg" icon="calendarFill" onPress={goBookings}>Voir mes rendez-vous</Btn>
          <Btn full size="lg" variant="ghost" onPress={goHome}>Retour à l'accueil</Btn>
        </View>
      </SafeAreaView>
    </View>
  );
}

function RecapRow({ icon, label, val, green }) {
  return (
    <View style={styles.recapRow}>
      <Icon name={icon} size={19} color={green ? C.leaf : C.brand} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.recapKicker}>{label}</Text>
        <Text style={[styles.recapVal, green && { color: C.leaf }]}>{val}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrap: { backgroundColor: "#fff" },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 12,
  },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 19, fontWeight: "700", color: C.ink, fontFamily: F.displayBold },

  recapLogo: {
    width: 48, height: 48, borderRadius: 15,
    alignItems: "center", justifyContent: "center",
  },
  recapLab:  { fontSize: 16, fontWeight: "700", color: C.ink, fontFamily: F.displayBold },
  recapMeta: { fontSize: 12.5, fontWeight: "700", color: C.inkSoft, marginTop: 1, fontFamily: F.body },

  sectLabel: { fontSize: 16, fontWeight: "700", color: C.ink, marginBottom: 12, fontFamily: F.displayBold },

  modeBtn: {
    flex: 1, backgroundColor: "#fff", borderRadius: 18, padding: 13,
    borderWidth: 2, borderColor: C.hair,
  },
  modeLabel: { fontSize: 13.5, fontWeight: "700", color: C.ink, marginTop: 4, fontFamily: F.displayBold },
  modeSub:   { fontSize: 11, fontWeight: "700", color: C.inkSoft, marginTop: 1, fontFamily: F.body },

  addressInput: {
    backgroundColor: "#fff", borderRadius: 18, borderWidth: 1.5, borderColor: C.hair,
    padding: 14, fontSize: 14, color: C.ink, minHeight: 60,
    marginBottom: 22,
  },

  dayBtn: {
    width: 58, paddingVertical: 12,
    borderRadius: 16, backgroundColor: "#fff",
    borderWidth: 1.5, borderColor: C.hair,
    alignItems: "center",
  },
  dayLabel: { fontSize: 12, fontWeight: "800", color: C.inkSoft },
  dayNum:   { fontSize: 20, fontWeight: "700", color: C.ink, marginTop: 2 },

  slotBtn: {
    width: "23.2%", paddingVertical: 11,
    borderRadius: 13, alignItems: "center",
  },
  slotText: { fontSize: 14.5, fontWeight: "700", color: C.ink },

  qHelp:      { fontSize: 12.5, fontWeight: "700", color: C.inkSoft, marginBottom: 4 },
  qBlock:     { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.hairSoft },
  qTestHead:  { fontSize: 13.5, fontWeight: "700", color: C.ink },
  qLabel:     { fontSize: 13, fontWeight: "700", color: C.ink, marginBottom: 4 },
  qInput: {
    backgroundColor: C.bgElev, borderRadius: 12, padding: 10,
    fontSize: 14, color: C.ink, borderWidth: 1, borderColor: C.hairSoft,
  },

  cnamIcon: {
    width: 40, height: 40, borderRadius: 13,
    alignItems: "center", justifyContent: "center",
  },
  cnamTitle: { fontSize: 14.5, fontWeight: "700", color: C.ink },
  cnamSub:   { fontSize: 12, fontWeight: "700", color: C.inkSoft, marginTop: 2 },

  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    padding: 20, paddingBottom: 30, backgroundColor: "#fff",
    ...SHADOW.md,
  },

  // Success
  checkCircle: {
    width: 116, height: 116, borderRadius: 999,
    alignItems: "center", justifyContent: "center",
  },
  checkGlyph: { fontSize: 56, color: "#fff", fontWeight: "800" },
  confirmTitle: { fontSize: 26, fontWeight: "700", color: C.ink, textAlign: "center", marginBottom: 8, fontFamily: F.displayBold },
  confirmSub: {
    fontSize: 14.5, fontWeight: "700", color: C.inkSoft,
    textAlign: "center", maxWidth: 280, lineHeight: 20, marginBottom: 4,
    fontFamily: F.body,
  },

  recapRow: { flexDirection: "row", gap: 11, paddingTop: 13, alignItems: "flex-start" },
  recapKicker: { fontSize: 11, fontWeight: "800", color: C.inkSoft, letterSpacing: 0.4, fontFamily: F.bodyBold },
  recapVal:    { fontSize: 14, fontWeight: "700", color: C.ink, marginTop: 2, fontFamily: F.display },

  totalPill: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginTop: 14, paddingVertical: 13, paddingHorizontal: 15,
    borderRadius: 16, backgroundColor: hexA(C.brand, 0.10),
  },
});
