/* eslint-disable react-native/no-inline-styles */
import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../auth";
import * as api from "../api";
import { C, R, SHADOW } from "../theme";

/**
 * Inscription patient en deux étapes :
 *   1. Saisie du téléphone → /auth/otp/request/
 *   2. Code SMS + nom/prénom (et email facultatif) →
 *        /auth/otp/verify/ crée le User + PatientProfile auto,
 *        puis PATCH /auth/me/ pour ajouter les noms.
 */
export default function SignUpScreen({ navigation }) {
  const { loginWithPhone, updateProfile } = useAuth();
  const [phone, setPhone] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState("info"); // info | otp
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const requestOtp = async () => {
    setError(null);
    if (!firstName.trim() || !lastName.trim()) {
      return setError("Prénom et nom sont requis.");
    }
    if (!phone.trim()) return setError("Saisissez votre numéro.");

    setLoading(true);
    try {
      await api.otpRequest(phone.trim(), "register");
      setStep("otp");
    } catch (e) {
      setError(e?.detail || "Impossible d'envoyer le code.");
    } finally { setLoading(false); }
  };

  const verifyAndFinish = async () => {
    setError(null);
    if (code.length !== 6) return setError("Code à 6 chiffres.");
    setLoading(true);
    try {
      // Étape 1 : crée le User (côté backend) via OTP
      await loginWithPhone(phone.trim(), code);
      // Étape 2 : complète le profil
      await updateProfile({
        first_name: firstName.trim(),
        last_name:  lastName.trim(),
        email:      email.trim() || undefined,
      });
      Alert.alert("Bienvenue ", "Votre compte a été créé.", [{ text: "OK" }]);
      // Le RootNav détecte l'authentification → bascule vers Main automatiquement
    } catch (e) {
      setError(e?.detail || "Code invalide.");
    } finally { setLoading(false); }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginBottom: 8 }}>
            <Text style={{ color: C.o, fontWeight: "600" }}>← Retour</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Créer votre <Text style={{ color: C.o, fontStyle: "italic" }}>compte</Text></Text>
          <Text style={styles.subtitle}>
            Quelques infos pour vous accueillir au mieux.
          </Text>

          {error && <Text style={styles.error}>⚠ {error}</Text>}

          {step === "info" && (
            <>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Prénom *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Mohamed"
                    placeholderTextColor={C.ink3}
                    value={firstName}
                    onChangeText={setFirstName}
                    autoCapitalize="words"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Nom *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Ould Cheikh"
                    placeholderTextColor={C.ink3}
                    value={lastName}
                    onChangeText={setLastName}
                    autoCapitalize="words"
                  />
                </View>
              </View>

              <Text style={styles.label}>Téléphone *</Text>
              <TextInput
                style={styles.input}
                placeholder="+222 22 …"
                placeholderTextColor={C.ink3}
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
              />

              <Text style={styles.label}>Email (facultatif)</Text>
              <TextInput
                style={styles.input}
                placeholder="vous@exemple.mr"
                placeholderTextColor={C.ink3}
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
              />

              <TouchableOpacity
                style={[styles.primary, loading && { opacity: 0.7 }]}
                onPress={requestOtp}
                disabled={loading}
              >
                {loading ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.primaryText}>Recevoir un code SMS</Text>
                )}
              </TouchableOpacity>

              <Text style={styles.hint}>
                💡 Démo : tapez n'importe quel code à 6 chiffres ensuite.
              </Text>
            </>
          )}

          {step === "otp" && (
            <>
              <Text style={styles.label}>Code reçu au {phone}</Text>
              <TextInput
                style={[styles.input, styles.code]}
                placeholder="••••••"
                placeholderTextColor={C.ink3}
                keyboardType="number-pad"
                maxLength={6}
                value={code}
                onChangeText={setCode}
              />
              <TouchableOpacity
                style={[styles.primary, loading && { opacity: 0.7 }]}
                onPress={verifyAndFinish}
                disabled={loading}
              >
                {loading ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.primaryText}>Créer mon compte</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setStep("info"); setCode(""); setError(null); }}>
                <Text style={styles.link}>← Modifier mes informations</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 24, paddingTop: 16, gap: 8 },
  title: { fontSize: 32, color: C.ink, fontWeight: "500", lineHeight: 36, marginTop: 12 },
  subtitle: { color: C.ink2, fontSize: 14, marginTop: 6, marginBottom: 18 },
  row: { flexDirection: "row", gap: 10 },
  label: { color: C.ink2, fontSize: 12.5, fontWeight: "500", marginTop: 8, marginBottom: 6 },
  input: {
    backgroundColor: C.surface, borderColor: C.line2, borderWidth: 1,
    borderRadius: R.sm, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: C.ink,
  },
  code: { textAlign: "center", fontSize: 26, letterSpacing: 8, fontWeight: "600" },
  primary: {
    backgroundColor: C.o, paddingVertical: 14, borderRadius: R.sm,
    alignItems: "center", marginTop: 16, ...SHADOW.sm,
  },
  primaryText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  link: { color: C.o, textAlign: "center", marginTop: 14, fontWeight: "500" },
  hint: {
    fontSize: 12, color: C.ink3, marginTop: 14, padding: 10,
    backgroundColor: C.bgElev, borderRadius: 9,
  },
  error: { color: C.rose, backgroundColor: C.roseTint, padding: 10, borderRadius: 9, marginBottom: 6 },
});
