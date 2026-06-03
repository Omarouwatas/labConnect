// LoginScreen — refonte visuelle d'après le design Anthropic labConnect.
// Hero turquoise avec icônes médicales flottantes (droplet, vial,
// stethoscope, dna), formulaire téléphone +222, onglet Email + mot
// de passe, bouton Google natif (3 méthodes d'auth backend).
import React, { useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import Constants from "expo-constants";
import { useAuth } from "../auth";
import * as api from "../api";
import { C, R, SHADOW, F } from "../theme";
import { Btn, hexA } from "../components/UI";
import { Icon } from "../icons";

WebBrowser.maybeCompleteAuthSession();
const GOOGLE_IDS = Constants?.expoConfig?.extra?.googleClientIds || {};

export default function LoginScreen({ navigation }) {
  const { loginWithPhone, loginWithEmail, loginWithGoogle } = useAuth();

  // ── State auth ───────────────────────────────────────────────────────
  const [tab, setTab] = useState("phone");        // phone | email
  const [phone, setPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpStep, setOtpStep] = useState("phone"); // phone | otp
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // ── Google OAuth ────────────────────────────────────────────────────
  const [_req, googleResponse, promptGoogle] = Google.useIdTokenAuthRequest({
    clientId: GOOGLE_IDS.expo,
    iosClientId: GOOGLE_IDS.ios,
    androidClientId: GOOGLE_IDS.android,
    webClientId: GOOGLE_IDS.web,
    scopes: ["openid", "email", "profile"],
  });

  useEffect(() => {
    if (googleResponse?.type === "success") {
      const idToken = googleResponse.params?.id_token || googleResponse.authentication?.idToken;
      if (idToken) doGoogleLogin(idToken);
    } else if (googleResponse?.type === "error") {
      setError("Connexion Google annulée.");
    }
  }, [googleResponse]);

  // ── Actions ─────────────────────────────────────────────────────────
  const askOtp = async () => {
    setError(null);
    if (!phone.trim()) return setError("Saisissez votre numéro.");
    setLoading(true);
    try {
      await api.otpRequest(`+222${phone.replace(/\D/g, "")}`, "login");
      setOtpStep("otp");
    } catch (e) {
      setError(e?.detail || "Impossible d'envoyer le code.");
    } finally { setLoading(false); }
  };
  const verifyOtp = async () => {
    setError(null);
    if (!otpCode || otpCode.length < 4) return setError("Saisissez le code reçu.");
    setLoading(true);
    try {
      await loginWithPhone(`+222${phone.replace(/\D/g, "")}`, otpCode);
    } catch (e) {
      setError(e?.detail || "Code invalide.");
    } finally { setLoading(false); }
  };

  const doGoogleLogin = async (idToken) => {
    setLoading(true); setError(null);
    try {
      const data = await loginWithGoogle(idToken);
      if (data?.created) Alert.alert("Bienvenue", "Votre compte vient d'être créé avec Google.");
    } catch (e) {
      setError(e?.detail || "Connexion Google refusée.");
    } finally { setLoading(false); }
  };

  const onGoogle = () => {
    if (!GOOGLE_IDS.expo && !GOOGLE_IDS.android && !GOOGLE_IDS.ios && !GOOGLE_IDS.web) {
      Alert.alert("Google indisponible", "Renseignez `expo.extra.googleClientIds` dans app.json.");
      return;
    }
    setError(null);
    promptGoogle();
  };

  const onEmail = async () => {
    setError(null);
    if (!email.trim() || !password) return setError("Email + mot de passe requis.");
    setLoading(true);
    try {
      await loginWithEmail(email.trim(), password);
    } catch (e) {
      setError(e?.detail || "Identifiants invalides.");
    } finally { setLoading(false); }
  };

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Hero turquoise */}
      <View style={styles.hero}>
        {/* icônes médicales flottantes décoratives */}
        <FloatingIcon name="droplet"     top={26} left="14%" rotate="18deg" />
        <FloatingIcon name="vial"        top={30} right="10%" rotate="-10deg" />
        <FloatingIcon name="stethoscope" top={64} left="60%" rotate="12deg" />
        <FloatingIcon name="dna"         top={78} left="8%" rotate="-14deg" />
        <View style={styles.heroBubble} />
        <SafeAreaView edges={["top"]} style={{ alignItems: "center" }}>
          <View style={styles.heroLogo}>
            <Icon name="stethoscope" size={42} color="#fff" />
          </View>
          <Text style={styles.heroTitle}>
            lab<Text style={{ color: C.sun }}>Connect</Text>
          </Text>
          <Text style={styles.heroTag}>
            Vos analyses médicales, au labo ou livrées à domicile
          </Text>
        </SafeAreaView>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.bigHi}>Bienvenue</Text>
          <Text style={styles.subHi}>Connectez-vous pour réserver vos analyses</Text>

          {/* Tabs : 2 modes (téléphone OTP / email + mot de passe) */}
          <View style={styles.tabs}>
            {[
              { id: "phone", label: "Téléphone", icon: "phone" },
              { id: "email", label: "Email",     icon: "mail" },
            ].map((t) => {
              const on = tab === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => { setTab(t.id); setError(null); }}
                  style={[styles.tabBtn, on && styles.tabBtnOn]}
                  activeOpacity={0.85}
                >
                  <Icon name={t.icon} size={15} color={on ? "#fff" : C.inkSoft} />
                  <Text style={[styles.tabLabel, on && styles.tabLabelOn]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* ── Onglet téléphone ────────────────────────────────────── */}
          {tab === "phone" && otpStep === "phone" && (
            <>
              <Text style={styles.fieldLabel}>Numéro de téléphone</Text>
              <View style={styles.phoneRow}>
                <Text style={styles.phonePrefix}>🇲🇷 +222</Text>
                <View style={styles.phoneSep} />
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  inputMode="numeric"
                  placeholder="46 12 34 56"
                  placeholderTextColor={C.inkSoft}
                  style={styles.phoneInput}
                />
              </View>
              <Btn full size="lg" iconR="arrowR" loading={loading} onPress={askOtp}>
                Recevoir le code
              </Btn>
            </>
          )}

          {tab === "phone" && otpStep === "otp" && (
            <>
              <Text style={styles.fieldLabel}>Code reçu par SMS</Text>
              <TextInput
                value={otpCode}
                onChangeText={setOtpCode}
                inputMode="numeric"
                placeholder="123456"
                placeholderTextColor={C.inkSoft}
                style={styles.otpInput}
                maxLength={6}
              />
              <Btn full size="lg" iconR="check" loading={loading} onPress={verifyOtp}>
                Vérifier
              </Btn>
              <TouchableOpacity onPress={() => setOtpStep("phone")} style={{ marginTop: 14, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Icon name="arrowL" size={15} color={C.inkSoft} />
                <Text style={{ color: C.inkSoft, fontWeight: "700" }}>Changer de numéro</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── Onglet email + mot de passe ───────────────────────── */}
          {tab === "email" && (
            <>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                inputMode="email"
                autoCapitalize="none"
                placeholder="mariem@example.com"
                placeholderTextColor={C.inkSoft}
                style={styles.textInput}
              />
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Mot de passe</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder="••••••••"
                placeholderTextColor={C.inkSoft}
                style={styles.textInput}
              />
              <View style={{ height: 16 }} />
              <Btn full size="lg" iconR="arrowR" loading={loading} onPress={onEmail}>
                Se connecter
              </Btn>
            </>
          )}

          {/* Séparateur + Google natif (toujours visible) */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>ou</Text>
            <View style={styles.dividerLine} />
          </View>

          <Btn full size="lg" variant="ghost" icon="google" onPress={onGoogle}>
            Continuer avec Google
          </Btn>

          {/* Pied : badge CNAM + CGU */}
          <View style={styles.cnamPill}>
            <Icon name="shieldFill" size={18} color={C.leaf} />
            <Text style={styles.cnamText}>
              Conventionné CNAM · jusqu'à 80% pris en charge
            </Text>
          </View>

          <Text style={styles.cgu}>
            En continuant, vous acceptez nos Conditions et notre Politique de confidentialité.
          </Text>

          {/* Lien sign-up */}
          <TouchableOpacity
            style={{ alignSelf: "center", marginTop: 16, padding: 8 }}
            onPress={() => navigation.navigate("SignUp")}
          >
            <Text style={{ color: C.brandDeep, fontWeight: "800", fontSize: 14 }}>
              Pas encore de compte ? Créer un profil
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Mini composant : icône médicale flottante (décoratif) ─────────────
function FloatingIcon({ name, top, left, right, rotate }) {
  return (
    <View
      style={{
        position: "absolute", top, left, right,
        opacity: 0.85,
        transform: [{ rotate }],
      }}
    >
      <Icon name={name} size={26} color="#fff" />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: C.brand,
    paddingTop: 60, paddingBottom: 54,
    borderBottomLeftRadius: 40, borderBottomRightRadius: 40,
    overflow: "hidden",
  },
  heroBubble: {
    position: "absolute", top: -70, right: -60,
    width: 220, height: 220, borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  heroLogo: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center", justifyContent: "center",
    marginBottom: 14,
  },
  heroTitle: {
    fontSize: 34, color: "#fff",
    fontWeight: "700", letterSpacing: -0.5,
    marginBottom: 4,
    fontFamily: F.displayBold,
  },
  heroTag: {
    color: "rgba(255,255,255,0.92)", fontWeight: "700",
    fontSize: 14.5, textAlign: "center",
    paddingHorizontal: 40, lineHeight: 20,
    fontFamily: F.body,
  },

  body: { padding: 22, paddingBottom: 40 },
  bigHi: { fontSize: 26, fontWeight: "700", color: C.ink, marginBottom: 4, fontFamily: F.displayBold },
  subHi: { fontSize: 14, fontWeight: "700", color: C.inkSoft, marginBottom: 20, fontFamily: F.body },

  tabs: {
    flexDirection: "row", gap: 6, backgroundColor: "#fff",
    borderRadius: 999, padding: 5,
    borderWidth: 1.5, borderColor: C.hair,
    marginBottom: 16,
  },
  tabBtn:    {
    flex: 1, paddingVertical: 9, borderRadius: 999,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
  },
  tabBtnOn:  { backgroundColor: C.brand },
  tabLabel:  { color: C.inkSoft, fontWeight: "800", fontSize: 13, fontFamily: F.bodyBold },
  tabLabelOn:{ color: "#fff" },

  errorBox: {
    backgroundColor: hexA(C.coral, 0.13),
    borderRadius: 14, padding: 12, marginBottom: 12,
  },
  errorText: { color: C.coral, fontWeight: "700", fontSize: 13.5 },

  fieldLabel: { fontWeight: "800", fontSize: 13, color: C.ink, marginBottom: 8, fontFamily: F.bodyBold },

  phoneRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#fff", borderRadius: 18,
    paddingHorizontal: 16, paddingVertical: 6,
    borderWidth: 1.5, borderColor: C.hair,
    marginBottom: 16,
  },
  phonePrefix: { fontSize: 17, fontWeight: "700", color: C.ink, fontFamily: F.display },
  phoneSep: { width: 1, height: 22, backgroundColor: C.hair },
  phoneInput: {
    flex: 1, fontSize: 17, color: C.ink,
    paddingVertical: 10, fontWeight: "600",
  },

  otpInput: {
    backgroundColor: "#fff", borderRadius: 18, borderWidth: 1.5, borderColor: C.hair,
    paddingHorizontal: 18, paddingVertical: 14,
    fontSize: 22, color: C.ink, fontWeight: "700",
    textAlign: "center", letterSpacing: 8,
    marginBottom: 16,
  },

  textInput: {
    backgroundColor: "#fff", borderRadius: 18, borderWidth: 1.5, borderColor: C.hair,
    paddingHorizontal: 16, paddingVertical: 13,
    fontSize: 15, color: C.ink,
  },

  dividerRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginVertical: 20,
  },
  dividerLine: { flex: 1, height: 1.5, backgroundColor: C.hair },
  dividerText: { fontWeight: "800", fontSize: 13, color: C.inkSoft },

  cnamPill: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: hexA(C.leaf, 0.12),
    borderRadius: 16, marginTop: 22,
  },
  cnamText: { flex: 1, fontWeight: "800", fontSize: 13, color: C.ink, fontFamily: F.bodyBold },

  cgu: {
    marginTop: 16, textAlign: "center",
    fontWeight: "600", fontSize: 11.5, color: C.inkSoft,
    lineHeight: 16,
  },
});
