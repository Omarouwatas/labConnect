// LoginScreen — flow unifié :
//
//   1. Un seul champ « Email ou téléphone », pré-rempli avec le dernier
//      identifiant utilisé (mémorisé dans AsyncStorage après chaque login).
//   2. Un seul bouton « Se connecter ».
//   3. Au tap :
//        - Si l'identifiant correspond au téléphone d'un appareil de
//          confiance enregistré → on déclenche Face ID / empreinte. Succès
//          = JWT immédiat.
//        - Sinon (ou Face ID échoué/annulé) → on bascule sur la 2ᵉ étape :
//             • si email → champ « Mot de passe » → POST /auth/login/email/
//             • si téléphone → on envoie un OTP SMS et on demande le code
//                              → POST /auth/otp/verify/
//   4. Bouton secondaire Google + lien vers SignUp en bas.
//
// La biométrie reste opt-in : elle est proposée après une 1ʳᵉ connexion
// OTP réussie (alert « Activer Face ID ? »). Tant que ce n'est pas fait,
// le bouton « Se connecter » mène directement à l'étape mot de passe / OTP.
import React, { useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import Constants from "expo-constants";
import { getLastIdentifier, useAuth } from "../auth";
import * as api from "../api";
import {
  bioStore,
  describeBiometric,
  getDeviceId,
  inspectBiometric,
} from "../biometric";
import { C, R, SHADOW, F } from "../theme";
import { Btn, hexA } from "../components/UI";
import { Icon } from "../icons";

WebBrowser.maybeCompleteAuthSession();
const GOOGLE_IDS = Constants?.expoConfig?.extra?.googleClientIds || {};

// ── Helpers ────────────────────────────────────────────────────────────

/** Reconnaît un email à la présence d'un `@`. */
const looksLikeEmail = (s) => typeof s === "string" && s.includes("@");

/**
 * Normalise un téléphone saisi par l'utilisateur en format E.164 mauritanien.
 * Accepte : "46 12 34 56", "+22246123456", "22246123456", "0046123456"…
 */
function normalizePhone(raw) {
  const v = (raw || "").trim();
  const digits = v.replace(/\D/g, "");
  if (!digits) return "";
  if (v.startsWith("+")) return "+" + digits;
  if (digits.startsWith("222")) return "+" + digits;
  return "+222" + digits;
}

/** Compare deux numéros par les 8 derniers chiffres (insensible au préfixe). */
function samePhone(a, b) {
  if (!a || !b) return false;
  const da = a.replace(/\D/g, "").slice(-8);
  const db = b.replace(/\D/g, "").slice(-8);
  return da.length === 8 && da === db;
}

// ── Composant principal ────────────────────────────────────────────────

export default function LoginScreen({ navigation }) {
  const {
    loginWithPhone, loginWithEmail, loginWithGoogle,
    loginWithBiometric, enableBiometric,
  } = useAuth();

  // ── State du flow ──────────────────────────────────────────────────
  // step = "id"   → champ identifier seul, bouton "Se connecter"
  //      = "pwd"  → identifier verrouillé + champ mot de passe (cas email)
  //      = "otp"  → identifier verrouillé + champ code SMS (cas téléphone)
  const [step, setStep] = useState("id");
  const [identifier, setIdentifier] = useState("");
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hint, setHint] = useState(null);

  // ── State biométrie ──────────────────────────────────────────────
  const [bio, setBio] = useState({
    eligible: false,
    label: "Face ID",
    icon: "faceId",
    phone: null,
    supported: false,
    types: [],
  });

  // ── Hydratation initiale : last identifier + état biométrie ─────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [last, stored, insp] = await Promise.all([
        getLastIdentifier(),
        bioStore.get(),
        inspectBiometric(),
      ]);
      if (cancelled) return;
      if (last) setIdentifier(last);

      if (!insp.supported || !stored) {
        setBio((b) => ({ ...b, supported: insp.supported, types: insp.types || [] }));
        return;
      }
      // Vérifie côté serveur que le device n'a pas été révoqué.
      let okOnServer = false;
      try {
        const deviceId = await getDeviceId();
        const res = await api.biometricCheck(stored.phone, deviceId);
        okOnServer = !!res?.eligible;
      } catch { okOnServer = false; }
      if (!okOnServer) {
        await bioStore.clear();
        setBio((b) => ({ ...b, supported: true, types: insp.types, eligible: false }));
        return;
      }
      const d = describeBiometric(insp.types);
      setBio({
        supported: true, types: insp.types,
        eligible: true, label: d.label, icon: d.icon,
        phone: stored.phone,
      });
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Google OAuth ─────────────────────────────────────────────────
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

  // ── Actions ────────────────────────────────────────────────────────

  /**
   * Cœur du flow : appelée au tap sur « Se connecter ».
   *   - step "id"  → on tente Face ID (si match) puis on bascule sur
   *                  l'étape secret appropriée.
   *   - step "pwd" → login email + mot de passe.
   *   - step "otp" → login téléphone + code SMS.
   */
  const onPrimary = async () => {
    setError(null);

    // ─ Étape "id" : choisir le bon mode d'authentification ────────
    if (step === "id") {
      const raw = identifier.trim();
      if (!raw) return setError("Saisissez votre email ou votre téléphone.");

      // 1) Tentative biométrique si l'identifiant correspond
      const isEmail = looksLikeEmail(raw);
      const normalizedPhone = isEmail ? null : normalizePhone(raw);
      const biometricMatches =
        bio.eligible && !isEmail && samePhone(normalizedPhone, bio.phone);

      if (biometricMatches) {
        setLoading(true);
        try {
          const ok = await loginWithBiometric();
          if (ok) return; // ✅ Connecté, le RootNav bascule sur Main
          // sinon : Face ID annulé → on tombe en fallback
        } catch (e) {
          if (e?.code === "invalid_device") {
            setBio((b) => ({ ...b, eligible: false }));
            setError("Cet appareil a été révoqué, reconnectez-vous classiquement.");
          }
          // pour les autres erreurs, on poursuit avec le fallback
        } finally { setLoading(false); }
      }

      // 2) Fallback : on demande le secret approprié
      if (isEmail) {
        setStep("pwd");
        setHint(null);
      } else {
        // Téléphone → envoie l'OTP automatiquement
        setLoading(true);
        try {
          await api.otpRequest(normalizedPhone, "login");
          setStep("otp");
          setHint(`Code envoyé au ${normalizedPhone}.`);
        } catch (e) {
          setError(e?.detail || "Impossible d'envoyer le code SMS.");
        } finally { setLoading(false); }
      }
      return;
    }

    // ─ Étape "pwd" : email + mot de passe ────────────────────────
    if (step === "pwd") {
      if (!secret) return setError("Saisissez votre mot de passe.");
      setLoading(true);
      try {
        await loginWithEmail(identifier.trim().toLowerCase(), secret);
      } catch (e) {
        setError(e?.detail || "Identifiants invalides.");
      } finally { setLoading(false); }
      return;
    }

    // ─ Étape "otp" : téléphone + code SMS ────────────────────────
    if (step === "otp") {
      if (!secret || secret.length < 4) return setError("Saisissez le code reçu.");
      const phone = normalizePhone(identifier);
      setLoading(true);
      try {
        await loginWithPhone(phone, secret);
        // 1ʳᵉ connexion sur cet appareil → proposer Face ID pour la prochaine fois.
        offerBiometricEnrollment();
      } catch (e) {
        setError(e?.detail || "Code invalide.");
      } finally { setLoading(false); }
      return;
    }
  };

  /** Revenir à l'étape identifiant (changer d'email/téléphone). */
  const onChangeIdentifier = () => {
    setStep("id");
    setSecret("");
    setError(null);
    setHint(null);
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

  /** Propose d'activer Face ID après une connexion OTP réussie. */
  const offerBiometricEnrollment = async () => {
    try {
      const insp = await inspectBiometric();
      if (!insp.supported) return;
      const d = describeBiometric(insp.types);
      Alert.alert(
        `Activer ${d.label} ?`,
        `Reconnectez-vous instantanément la prochaine fois grâce à ${d.label}, sans passer par le SMS.`,
        [
          { text: "Plus tard", style: "cancel" },
          { text: "Activer", onPress: () => enableBiometric().catch(() => {}) },
        ],
      );
    } catch { /* opt-in, on ignore */ }
  };

  // ── Render ─────────────────────────────────────────────────────────

  const isEmailMode = looksLikeEmail(identifier);
  const willUseBiometric =
    step === "id" && bio.eligible &&
    !isEmailMode &&
    samePhone(normalizePhone(identifier), bio.phone);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Hero turquoise */}
      <View style={styles.hero}>
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
          <Text style={styles.subHi}>
            Connectez-vous pour réserver vos analyses
          </Text>

          {/* ── Champ identifiant ─────────────────────────────────────── */}
          <Text style={styles.fieldLabel}>Email ou téléphone</Text>
          <View style={styles.inputWrap}>
            <View style={styles.inputIcon}>
              <Icon
                name={isEmailMode ? "mail" : "phone"}
                size={18}
                color={C.brand}
              />
            </View>
            <TextInput
              value={identifier}
              onChangeText={(v) => {
                setIdentifier(v);
                if (step !== "id") onChangeIdentifier();
              }}
              editable={step === "id"}
              placeholder="vous@exemple.mr  ou  +222 46 12 34 56"
              placeholderTextColor={C.inkSoft}
              keyboardType={isEmailMode ? "email-address" : "default"}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
          </View>

          {/* ── Champ secret (mot de passe ou code) ─────────────────── */}
          {step === "pwd" && (
            <>
              <Text style={[styles.fieldLabel, { marginTop: 14 }]}>
                Mot de passe
              </Text>
              <View style={styles.inputWrap}>
                <View style={styles.inputIcon}>
                  <Icon name="lock" size={18} color={C.brand} />
                </View>
                <TextInput
                  value={secret}
                  onChangeText={setSecret}
                  placeholder="••••••••"
                  placeholderTextColor={C.inkSoft}
                  secureTextEntry
                  autoCapitalize="none"
                  autoFocus
                  style={styles.input}
                />
              </View>
            </>
          )}

          {step === "otp" && (
            <>
              <Text style={[styles.fieldLabel, { marginTop: 14 }]}>
                Code reçu par SMS
              </Text>
              <TextInput
                value={secret}
                onChangeText={setSecret}
                placeholder="• • • • • •"
                placeholderTextColor={C.inkSoft}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
                style={styles.otpInput}
              />
            </>
          )}

          {/* ── Messages d'état ─────────────────────────────────────── */}
          {error ? (
            <View style={styles.errorBox}>
              <Icon name="alert" size={16} color={C.coral} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {hint && !error ? (
            <View style={styles.hintBox}>
              <Icon name="info" size={16} color={C.brand} />
              <Text style={styles.hintText}>{hint}</Text>
            </View>
          ) : null}

          {/* ── Bouton principal ────────────────────────────────────── */}
          <View style={{ height: 8 }} />
          <Btn
            full size="lg"
            icon={willUseBiometric ? bio.icon : undefined}
            iconR={willUseBiometric ? undefined : "arrowR"}
            loading={loading}
            onPress={onPrimary}
          >
            {willUseBiometric
              ? `Se connecter avec ${bio.label}`
              : step === "pwd"
                ? "Se connecter"
                : step === "otp"
                  ? "Vérifier le code"
                  : "Se connecter"}
          </Btn>

          {/* Lien "modifier l'identifiant" en étapes secret */}
          {step !== "id" && (
            <TouchableOpacity
              onPress={onChangeIdentifier}
              style={styles.changeIdRow}
            >
              <Icon name="arrowL" size={15} color={C.inkSoft} />
              <Text style={styles.changeIdText}>
                Changer d'email ou de numéro
              </Text>
            </TouchableOpacity>
          )}

          {/* Lien "renvoyer le SMS" en mode OTP */}
          {step === "otp" && (
            <TouchableOpacity
              onPress={async () => {
                setError(null);
                try {
                  await api.otpRequest(normalizePhone(identifier), "login");
                  setHint("Nouveau code envoyé.");
                } catch (e) {
                  setError(e?.detail || "Impossible de renvoyer le code.");
                }
              }}
              style={{ alignSelf: "center", marginTop: 8, padding: 6 }}
            >
              <Text style={styles.resendText}>Renvoyer le SMS</Text>
            </TouchableOpacity>
          )}

          {/* Séparateur + Google */}
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

  fieldLabel: {
    fontWeight: "800", fontSize: 13, color: C.ink,
    marginBottom: 8, fontFamily: F.bodyBold,
  },

  // Champ "boîte" avec icône à gauche
  inputWrap: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#fff", borderRadius: 18,
    borderWidth: 1.5, borderColor: C.hair,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  inputIcon: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    backgroundColor: hexA(C.brand, 0.10),
    marginRight: 6,
  },
  input: {
    flex: 1, fontSize: 15, color: C.ink,
    paddingVertical: 12, paddingHorizontal: 4,
    fontWeight: "600",
  },

  otpInput: {
    backgroundColor: "#fff", borderRadius: 18, borderWidth: 1.5, borderColor: C.hair,
    paddingHorizontal: 18, paddingVertical: 14,
    fontSize: 24, color: C.ink, fontWeight: "700",
    textAlign: "center", letterSpacing: 10,
  },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: hexA(C.coral, 0.12),
    borderRadius: 14, padding: 12, marginTop: 14,
  },
  errorText: { flex: 1, color: C.coral, fontWeight: "700", fontSize: 13 },

  hintBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: hexA(C.brand, 0.10),
    borderRadius: 14, padding: 12, marginTop: 14,
  },
  hintText: { flex: 1, color: C.brandDeep || C.brand, fontWeight: "700", fontSize: 13 },

  changeIdRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, marginTop: 14, padding: 6,
  },
  changeIdText: { color: C.inkSoft, fontWeight: "700", fontSize: 13 },

  resendText: { color: C.brandDeep || C.brand, fontWeight: "800", fontSize: 13 },

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
