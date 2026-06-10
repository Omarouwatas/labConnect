// ProfileScreen — header turquoise avec avatar initiales + chip CNAM,
// liste de réglages éditables (chaque ligne ouvre un modal dédié),
// section sécurité (biométrie), bouton déconnexion en rouge soft.
//
// Tous les champs persistés vivent dans User OU PatientProfile. Le
// CNAM (n° + pourcentage de couverture) est associé au patient, donc
// dès qu'il est rempli, il s'applique automatiquement à TOUS les RDV
// pris ensuite chez n'importe quel labo — le backend applique le split
// CNAM/patient au moment de la création des TestOrder.
import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Switch,
  Modal as RNModal, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { useAuth } from "../auth";
import {
  bioStore, describeBiometric, inspectBiometric,
} from "../biometric";
import { C, R, SHADOW, F } from "../theme";
import { Btn, hexA } from "../components/UI";
import { Icon } from "../icons";

// ── Helpers ─────────────────────────────────────────────────────────────

const GENDERS = [
  { id: "male",   label: "Homme" },
  { id: "female", label: "Femme" },
  { id: "other",  label: "Autre" },
];

const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

const fmtDateFR = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit", month: "long", year: "numeric",
    });
  } catch { return iso; }
};

// ── Modal éditeur générique ─────────────────────────────────────────────

function EditModal({ visible, title, onClose, onSave, saving, children, hint }) {
  return (
    <RNModal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={editStyles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ width: "100%" }}
        >
          <View style={editStyles.sheet}>
            <View style={editStyles.handle} />
            <View style={editStyles.header}>
              <TouchableOpacity onPress={onClose}>
                <Text style={editStyles.cancel}>Annuler</Text>
              </TouchableOpacity>
              <Text style={editStyles.title}>{title}</Text>
              <TouchableOpacity onPress={onSave} disabled={saving}>
                {saving
                  ? <ActivityIndicator color={C.brand} size="small" />
                  : <Text style={editStyles.save}>Enregistrer</Text>}
              </TouchableOpacity>
            </View>
            <ScrollView
              style={{ maxHeight: 480 }}
              contentContainerStyle={{ padding: 18 }}
              keyboardShouldPersistTaps="handled"
            >
              {children}
              {hint && (
                <View style={editStyles.hint}>
                  <Icon name="info" size={15} color={C.brand} />
                  <Text style={editStyles.hintText}>{hint}</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </RNModal>
  );
}

// ── Section field réutilisable ──────────────────────────────────────────
function Field({ label, children }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={editStyles.label}>{label}</Text>
      {children}
    </View>
  );
}
function TextField({ value, onChangeText, placeholder, keyboardType, autoCapitalize = "sentences", multiline = false }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={C.inkSoft}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      multiline={multiline}
      style={[editStyles.input, multiline && { minHeight: 80, textAlignVertical: "top" }]}
    />
  );
}

// ── Écran principal ────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { user, logout, updateProfile, enableBiometric, disableBiometric } = useAuth();

  const fullName = `${user?.first_name || ""} ${user?.last_name || ""}`.trim() || "Utilisateur";
  const initials = fullName
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0]?.toUpperCase()).join("");

  // ── État biométrie ─────────────────────────────────────────────────
  const [bio, setBio] = useState({
    supported: false, enabled: false,
    label: "Biométrie", icon: "shieldFill", busy: false,
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const insp = await inspectBiometric();
      const enabled = await bioStore.isEnabled();
      const d = insp.supported ? describeBiometric(insp.types) : null;
      if (cancelled) return;
      setBio((b) => ({
        ...b,
        supported: insp.supported,
        enabled,
        label: d?.label || "Biométrie",
        icon: d?.icon || "shieldFill",
      }));
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Quel modal est ouvert ? ────────────────────────────────────────
  const [editing, setEditing] = useState(null);
  const closeModal = () => setEditing(null);

  const onToggleBio = async (value) => {
    setBio((b) => ({ ...b, busy: true }));
    try {
      if (value) {
        const ok = await enableBiometric();
        setBio((b) => ({ ...b, enabled: !!ok, busy: false }));
        if (ok) Alert.alert("Activé", `${bio.label} est désormais utilisé pour vos reconnexions.`);
      } else {
        await disableBiometric();
        setBio((b) => ({ ...b, enabled: false, busy: false }));
      }
    } catch (e) {
      setBio((b) => ({ ...b, busy: false }));
      Alert.alert(`${bio.label} indisponible`, e?.message || "Impossible de configurer la biométrie.");
    }
  };

  const onLogout = () => {
    Alert.alert("Déconnexion", "Voulez-vous vraiment vous déconnecter ?", [
      { text: "Annuler", style: "cancel" },
      { text: "Déconnexion", style: "destructive", onPress: () => logout() },
    ]);
  };

  // ── Lignes de réglage ──────────────────────────────────────────────
  // Chaque entrée affiche son état courant en sub-text et ouvre un modal.
  const rows = useMemo(() => [
    {
      id: "info",
      icon: "user",
      color: C.brand,
      label: "Informations personnelles",
      sub: user?.email
        ? user.email
        : (user?.preferred_language === "ar" ? "العربية" : "Français"),
    },
    {
      id: "cnam",
      icon: "shieldFill",
      color: C.leaf,
      label: "Carte CNAM",
      sub: user?.cnam_number
        ? `n° ${user.cnam_number} · couverture ${user.cnam_coverage_pct ?? 0}%`
        : "Non renseigné — ajoutez votre carte",
    },
    {
      id: "health",
      icon: "stethoscope",
      color: C.coral,
      label: "Informations santé",
      sub: [
        user?.date_of_birth ? fmtDateFR(user.date_of_birth) : null,
        user?.gender ? (GENDERS.find((g) => g.id === user.gender)?.label) : null,
        user?.blood_type || null,
      ].filter(Boolean).join(" · ") || "Date de naissance, sexe, groupe sanguin",
    },
    {
      id: "addr",
      icon: "pinFill",
      color: C.grape,
      label: "Adresse par défaut",
      sub: user?.default_address || "Aucune adresse enregistrée",
    },
    {
      id: "emergency",
      icon: "phone",
      color: C.sun,
      label: "Contact d'urgence",
      sub: user?.emergency_contact || "Aucun contact",
    },
  ], [user]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        {/* Hero */}
        <View style={styles.hero}>
          <SafeAreaView edges={["top"]} style={{ alignItems: "center" }}>
            <View style={styles.heroAvatar}>
              <Text style={styles.heroInitials}>{initials || "?"}</Text>
            </View>
            <Text style={styles.heroName}>{fullName}</Text>
            <Text style={styles.heroPhone}>
              {user?.phone || user?.email || ""}
            </Text>
            {user?.cnam_number ? (
              <View style={styles.cnamChip}>
                <Icon name="shieldFill" size={16} color="#fff" />
                <Text style={styles.cnamChipText}>
                  CNAM · {user.cnam_coverage_pct ?? 0}% couvert
                </Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.cnamChip, { backgroundColor: "rgba(255,255,255,0.13)" }]}
                onPress={() => setEditing("cnam")}
                activeOpacity={0.85}
              >
                <Icon name="plus" size={15} color="#fff" />
                <Text style={styles.cnamChipText}>Ajouter ma carte CNAM</Text>
              </TouchableOpacity>
            )}
          </SafeAreaView>
        </View>

        {/* Liste des réglages */}
        <View style={{ padding: 20, gap: 10 }}>
          {rows.map((r) => (
            <TouchableOpacity
              key={r.id}
              activeOpacity={0.85}
              onPress={() => setEditing(r.id)}
              style={styles.row}
            >
              <View style={[styles.rowIcon, { backgroundColor: hexA(r.color, 0.14) }]}>
                <Icon name={r.icon} size={20} color={r.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{r.label}</Text>
                {r.sub && (
                  <Text style={styles.rowSub} numberOfLines={1}>{r.sub}</Text>
                )}
              </View>
              <Icon name="chevronR" size={20} color={C.inkSoft} />
            </TouchableOpacity>
          ))}

          {/* Biométrie (toggle) */}
          {bio.supported && (
            <View style={[styles.row, { alignItems: "center" }]}>
              <View style={[styles.rowIcon, { backgroundColor: hexA(C.brand, 0.14) }]}>
                <Icon name={bio.icon} size={20} color={C.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{bio.label}</Text>
                <Text style={styles.rowSub}>
                  {bio.enabled ? "Activée sur cet appareil" : "Reconnectez-vous sans SMS"}
                </Text>
              </View>
              <Switch
                value={bio.enabled}
                onValueChange={onToggleBio}
                disabled={bio.busy}
                trackColor={{ false: C.hair, true: hexA(C.brand, 0.55) }}
                thumbColor={bio.enabled ? C.brand : "#fff"}
              />
            </View>
          )}

          {/* Déconnexion */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onLogout}
            style={styles.logoutRow}
          >
            <Icon name="logout" size={19} color={C.coral} />
            <Text style={styles.logoutText}>Déconnexion</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ── Modaux d'édition ──────────────────────────────────────────── */}
      <EditInfoModal       visible={editing === "info"}      user={user} updateProfile={updateProfile} onClose={closeModal} />
      <EditCnamModal       visible={editing === "cnam"}      user={user} updateProfile={updateProfile} onClose={closeModal} />
      <EditHealthModal     visible={editing === "health"}    user={user} updateProfile={updateProfile} onClose={closeModal} />
      <EditAddressModal    visible={editing === "addr"}      user={user} updateProfile={updateProfile} onClose={closeModal} />
      <EditEmergencyModal  visible={editing === "emergency"} user={user} updateProfile={updateProfile} onClose={closeModal} />
    </View>
  );
}

// ── Modal Infos personnelles ────────────────────────────────────────────

function EditInfoModal({ visible, user, updateProfile, onClose }) {
  const [first, setFirst] = useState(user?.first_name || "");
  const [last,  setLast]  = useState(user?.last_name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [lang,  setLang]  = useState(user?.preferred_language || "fr");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setFirst(user?.first_name || "");
      setLast(user?.last_name || "");
      setEmail(user?.email || "");
      setLang(user?.preferred_language || "fr");
    }
  }, [visible, user]);

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile({
        first_name: first.trim(),
        last_name: last.trim(),
        email: email.trim() || undefined,
        preferred_language: lang,
      });
      onClose();
    } catch (e) {
      Alert.alert("Erreur", e?.detail || "Impossible d'enregistrer.");
    } finally { setSaving(false); }
  };

  return (
    <EditModal visible={visible} title="Informations" onClose={onClose} onSave={save} saving={saving}>
      <Field label="Prénom">
        <TextField value={first} onChangeText={setFirst} placeholder="Mohamed" autoCapitalize="words" />
      </Field>
      <Field label="Nom">
        <TextField value={last} onChangeText={setLast} placeholder="Ould Cheikh" autoCapitalize="words" />
      </Field>
      <Field label="Email">
        <TextField value={email} onChangeText={setEmail} placeholder="vous@exemple.mr" keyboardType="email-address" autoCapitalize="none" />
      </Field>
      <Field label="Langue préférée">
        <View style={{ flexDirection: "row", gap: 8 }}>
          {[
            { id: "fr", label: "Français" },
            { id: "ar", label: "العربية" },
          ].map((l) => {
            const on = lang === l.id;
            return (
              <TouchableOpacity
                key={l.id}
                onPress={() => setLang(l.id)}
                style={[editStyles.chip, on && editStyles.chipOn]}
                activeOpacity={0.85}
              >
                <Text style={[editStyles.chipText, on && editStyles.chipTextOn]}>{l.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Field>
    </EditModal>
  );
}

// ── Modal CNAM ──────────────────────────────────────────────────────────

function EditCnamModal({ visible, user, updateProfile, onClose }) {
  const [num, setNum] = useState(user?.cnam_number || "");
  const [pct, setPct] = useState(String(user?.cnam_coverage_pct ?? 80));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setNum(user?.cnam_number || "");
      setPct(String(user?.cnam_coverage_pct ?? 80));
    }
  }, [visible, user]);

  const save = async () => {
    const pctNum = Math.max(0, Math.min(100, parseInt(pct, 10) || 0));
    setSaving(true);
    try {
      await updateProfile({
        cnam_number: num.trim(),
        cnam_coverage_pct: pctNum,
      });
      onClose();
    } catch (e) {
      Alert.alert("Erreur", e?.detail || "Impossible d'enregistrer la CNAM.");
    } finally { setSaving(false); }
  };

  const clear = async () => {
    Alert.alert(
      "Retirer la CNAM ?",
      "Vos prochaines analyses seront facturées au prix plein.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Retirer", style: "destructive",
          onPress: async () => {
            setSaving(true);
            try {
              await updateProfile({ cnam_number: "", cnam_coverage_pct: 0 });
              onClose();
            } catch (e) {
              Alert.alert("Erreur", e?.detail || "Impossible de retirer la CNAM.");
            } finally { setSaving(false); }
          },
        },
      ],
    );
  };

  return (
    <EditModal
      visible={visible}
      title="Carte CNAM"
      onClose={onClose}
      onSave={save}
      saving={saving}
      hint="Une fois enregistrée, votre CNAM s'applique automatiquement à TOUS les rendez-vous que vous prenez chez les laboratoires conventionnés."
    >
      <Field label="Numéro CNAM">
        <TextField
          value={num}
          onChangeText={setNum}
          placeholder="123456789"
          keyboardType="number-pad"
          autoCapitalize="none"
        />
      </Field>
      <Field label="Pourcentage de couverture">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <TextField
            value={pct}
            onChangeText={(v) => setPct(v.replace(/[^0-9]/g, ""))}
            placeholder="80"
            keyboardType="number-pad"
          />
          <Text style={{ fontSize: 18, fontWeight: "800", color: C.ink }}>%</Text>
        </View>
      </Field>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: -6, marginBottom: 14 }}>
        {[60, 70, 80, 90, 100].map((v) => (
          <TouchableOpacity
            key={v}
            style={[editStyles.chip, pct === String(v) && editStyles.chipOn]}
            onPress={() => setPct(String(v))}
          >
            <Text style={[editStyles.chipText, pct === String(v) && editStyles.chipTextOn]}>{v}%</Text>
          </TouchableOpacity>
        ))}
      </View>
      {user?.cnam_number ? (
        <TouchableOpacity onPress={clear} style={editStyles.danger}>
          <Icon name="trash" size={16} color={C.coral} />
          <Text style={editStyles.dangerText}>Retirer ma carte CNAM</Text>
        </TouchableOpacity>
      ) : null}
    </EditModal>
  );
}

// ── Modal Santé ─────────────────────────────────────────────────────────

function EditHealthModal({ visible, user, updateProfile, onClose }) {
  const [dob, setDob] = useState(user?.date_of_birth || "");
  const [gender, setGender] = useState(user?.gender || "");
  const [blood, setBlood] = useState(user?.blood_type || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setDob(user?.date_of_birth || "");
      setGender(user?.gender || "");
      setBlood(user?.blood_type || "");
    }
  }, [visible, user]);

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile({
        date_of_birth: dob || null,
        gender,
        blood_type: blood,
      });
      onClose();
    } catch (e) {
      Alert.alert("Erreur", e?.detail || "Impossible d'enregistrer.");
    } finally { setSaving(false); }
  };

  return (
    <EditModal visible={visible} title="Informations santé" onClose={onClose} onSave={save} saving={saving}>
      <Field label="Date de naissance">
        <TextField
          value={dob}
          onChangeText={(v) => setDob(v.replace(/[^0-9-]/g, ""))}
          placeholder="AAAA-MM-JJ"
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
        />
        <Text style={editStyles.helper}>Format : 1990-05-15</Text>
      </Field>
      <Field label="Sexe">
        <View style={{ flexDirection: "row", gap: 8 }}>
          {GENDERS.map((g) => {
            const on = gender === g.id;
            return (
              <TouchableOpacity
                key={g.id}
                onPress={() => setGender(g.id)}
                style={[editStyles.chip, on && editStyles.chipOn]}
              >
                <Text style={[editStyles.chipText, on && editStyles.chipTextOn]}>{g.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Field>
      <Field label="Groupe sanguin">
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          {BLOOD_TYPES.map((b) => {
            const on = blood === b;
            return (
              <TouchableOpacity
                key={b}
                onPress={() => setBlood(on ? "" : b)}
                style={[editStyles.chip, on && editStyles.chipOn, { minWidth: 56 }]}
              >
                <Text style={[editStyles.chipText, on && editStyles.chipTextOn]}>{b}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Field>
    </EditModal>
  );
}

// ── Modal Adresse par défaut ────────────────────────────────────────────

function EditAddressModal({ visible, user, updateProfile, onClose }) {
  const [addr, setAddr] = useState(user?.default_address || "");
  const [lat, setLat]  = useState(user?.default_latitude || null);
  const [lng, setLng]  = useState(user?.default_longitude || null);
  const [busyGps, setBusyGps] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setAddr(user?.default_address || "");
      setLat(user?.default_latitude || null);
      setLng(user?.default_longitude || null);
    }
  }, [visible, user]);

  const useGps = async () => {
    setBusyGps(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission requise", "Activez la localisation pour utiliser votre position.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const { latitude, longitude } = pos.coords;
      setLat(latitude); setLng(longitude);

      // Reverse-geocode pour pré-remplir l'adresse texte
      try {
        const places = await Location.reverseGeocodeAsync({ latitude, longitude });
        const p = places?.[0];
        if (p) {
          const parts = [
            p.name, p.street, p.district, p.subregion, p.city, p.region, p.country,
          ].filter(Boolean);
          // Déduplique et garde un libellé lisible
          const dedup = [...new Set(parts)].join(", ");
          if (dedup) setAddr(dedup);
        }
      } catch { /* reverse geocoding peut échouer en mode offline */ }
    } catch (e) {
      Alert.alert("Erreur GPS", e?.message || "Impossible d'obtenir votre position.");
    } finally { setBusyGps(false); }
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile({
        default_address: addr.trim(),
        default_latitude: typeof lat === "number" ? lat : undefined,
        default_longitude: typeof lng === "number" ? lng : undefined,
      });
      onClose();
    } catch (e) {
      Alert.alert("Erreur", e?.detail || "Impossible d'enregistrer.");
    } finally { setSaving(false); }
  };

  return (
    <EditModal
      visible={visible}
      title="Adresse par défaut"
      onClose={onClose}
      onSave={save}
      saving={saving}
      hint="Cette adresse sera pré-remplie quand vous demandez un prélèvement à domicile."
    >
      <Field label="Adresse">
        <TextField
          value={addr}
          onChangeText={setAddr}
          placeholder="Quartier, rue, repère…"
          multiline
        />
      </Field>

      <TouchableOpacity
        onPress={useGps}
        disabled={busyGps}
        style={editStyles.gpsBtn}
        activeOpacity={0.85}
      >
        {busyGps
          ? <ActivityIndicator color={C.brand} />
          : <Icon name="nav" size={18} color={C.brand} />}
        <Text style={editStyles.gpsText}>Utiliser ma position actuelle</Text>
      </TouchableOpacity>

      {(lat !== null && lng !== null) && (
        <View style={editStyles.coords}>
          <Icon name="pinFill" size={14} color={C.brand} />
          <Text style={editStyles.coordsText}>
            {Number(lat).toFixed(5)}°, {Number(lng).toFixed(5)}°
          </Text>
        </View>
      )}
    </EditModal>
  );
}

// ── Modal Contact d'urgence ────────────────────────────────────────────

function EditEmergencyModal({ visible, user, updateProfile, onClose }) {
  const [val, setVal] = useState(user?.emergency_contact || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (visible) setVal(user?.emergency_contact || ""); }, [visible, user]);

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile({ emergency_contact: val.trim() });
      onClose();
    } catch (e) {
      Alert.alert("Erreur", e?.detail || "Impossible d'enregistrer.");
    } finally { setSaving(false); }
  };

  return (
    <EditModal
      visible={visible}
      title="Contact d'urgence"
      onClose={onClose}
      onSave={save}
      saving={saving}
      hint="Personne à prévenir en cas d'urgence pendant un prélèvement à domicile."
    >
      <Field label="Téléphone du contact">
        <TextField
          value={val}
          onChangeText={setVal}
          placeholder="+222 22 22 22 22"
          keyboardType="phone-pad"
          autoCapitalize="none"
        />
      </Field>
    </EditModal>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  hero: {
    backgroundColor: C.brand,
    paddingBottom: 26,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  heroAvatar: {
    width: 84, height: 84, borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center", justifyContent: "center",
    marginTop: 14,
  },
  heroInitials: { color: "#fff", fontSize: 32, fontWeight: "700", fontFamily: F.displayBold },
  heroName: { color: "#fff", fontSize: 22, fontWeight: "700", marginTop: 12, fontFamily: F.displayBold },
  heroPhone: { color: "rgba(255,255,255,0.8)", fontSize: 13.5, fontWeight: "700", marginTop: 2, fontFamily: F.body },
  cnamChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 12, paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 999, backgroundColor: "rgba(255,255,255,0.2)",
  },
  cnamChipText: { color: "#fff", fontWeight: "800", fontSize: 12.5, fontFamily: F.bodyBold },

  row: {
    flexDirection: "row", alignItems: "center", gap: 13,
    backgroundColor: "#fff", borderRadius: 18, padding: 14,
    ...SHADOW.sm,
  },
  rowIcon: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  rowLabel: { fontSize: 15, fontWeight: "600", color: C.ink, fontFamily: F.display },
  rowSub:   { fontSize: 12, fontWeight: "700", color: C.inkSoft, marginTop: 2 },

  logoutRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9,
    marginTop: 8, backgroundColor: hexA(C.coral, 0.12),
    borderRadius: 18, padding: 15,
  },
  logoutText: { fontSize: 15, fontWeight: "700", color: C.coral, fontFamily: F.displayBold },
});

const editStyles = StyleSheet.create({
  backdrop: {
    flex: 1, justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingBottom: 16,
  },
  handle: {
    alignSelf: "center", width: 44, height: 4, borderRadius: 999,
    backgroundColor: C.hair, marginTop: 8, marginBottom: 4,
  },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 18, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.hair,
  },
  title:  { fontSize: 16, fontWeight: "800", color: C.ink, fontFamily: F.displayBold },
  cancel: { fontSize: 14, fontWeight: "700", color: C.inkSoft },
  save:   { fontSize: 14, fontWeight: "800", color: C.brand },

  label: { fontWeight: "800", fontSize: 13, color: C.ink, marginBottom: 8, fontFamily: F.bodyBold },
  input: {
    backgroundColor: "#fff", borderRadius: 14,
    borderWidth: 1.5, borderColor: C.hair,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: C.ink, fontWeight: "600",
  },
  helper: { fontSize: 11.5, color: C.inkSoft, marginTop: 6, fontWeight: "700" },

  chip: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
    borderWidth: 1.5, borderColor: C.hair, backgroundColor: "#fff",
  },
  chipOn:   { borderColor: C.brand, backgroundColor: hexA(C.brand, 0.10) },
  chipText: { fontSize: 13, fontWeight: "800", color: C.inkSoft },
  chipTextOn: { color: C.brandDeep || C.brand },

  hint: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: hexA(C.brand, 0.09),
    borderRadius: 12, padding: 11, marginTop: 4,
  },
  hintText: { flex: 1, fontSize: 12.5, fontWeight: "700", color: C.ink, lineHeight: 17 },

  gpsBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, marginBottom: 14, paddingVertical: 13,
    borderRadius: 14, borderWidth: 1.5, borderColor: C.brand,
    backgroundColor: hexA(C.brand, 0.08),
  },
  gpsText: { fontSize: 14, fontWeight: "800", color: C.brandDeep || C.brand },
  coords: {
    flexDirection: "row", alignItems: "center", gap: 6,
    alignSelf: "center", paddingVertical: 6,
  },
  coordsText: { fontSize: 12, fontWeight: "700", color: C.inkSoft, fontFamily: F.body },

  danger: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, marginTop: 6, paddingVertical: 12, borderRadius: 14,
    backgroundColor: hexA(C.coral, 0.10),
  },
  dangerText: { fontSize: 13.5, fontWeight: "800", color: C.coral },
});
