import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as api from "./api";
import {
  bioStore,
  getDeviceId,
  inspectBiometric,
  promptBiometric,
} from "./biometric";

const AuthCtx = createContext(null);

// Dernier identifiant utilisé (email ou téléphone) — sert à pré-remplir
// le champ « Email ou téléphone » de l'écran de connexion. Non sensible.
const LAST_IDENTIFIER_KEY = "lc.last_identifier";

/** Lit le dernier identifiant utilisé (ou null). */
export const getLastIdentifier = () =>
  AsyncStorage.getItem(LAST_IDENTIFIER_KEY).catch(() => null);

/** Mémorise l'identifiant après un login réussi. Best-effort. */
const rememberIdentifier = (id) => {
  if (id) AsyncStorage.setItem(LAST_IDENTIFIER_KEY, id).catch(() => {});
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const hydrate = useCallback(async () => {
    const access = await api.tokens.getAccess();
    if (!access) { setUser(null); setLoading(false); return; }
    try {
      const me = await api.fetchMe();
      setUser(me);
    } catch {
      await api.tokens.clear();
      setUser(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { hydrate(); }, [hydrate]);

  const loginWithPhone = useCallback(async (phone, code) => {
    await api.otpVerify(phone, code, "login");
    rememberIdentifier(phone);
    setLoading(true);
    await hydrate();
  }, [hydrate]);

  const loginWithEmail = useCallback(async (email, password) => {
    await api.emailLogin(email, password);
    rememberIdentifier(email);
    setLoading(true);
    await hydrate();
  }, [hydrate]);

  const loginWithGoogle = useCallback(async (idToken) => {
    const data = await api.googleLogin(idToken);
    if (data?.user?.email) rememberIdentifier(data.user.email);
    setLoading(true);
    await hydrate();
    return data; // { created: bool, ... } pour rediriger vers SignUp si needed
  }, [hydrate]);

  /**
   * Connexion biométrique : Face ID / empreinte → backend → JWT.
   * À appeler depuis LoginScreen quand l'utilisateur tape le bouton
   * « Se connecter avec Face ID ».
   *
   * Renvoie true en cas de succès, false en cas d'échec (Face ID annulé,
   * token côté serveur invalidé, etc.). En cas de token serveur invalide,
   * on nettoie le stockage local pour éviter une boucle de prompts.
   */
  const loginWithBiometric = useCallback(async () => {
    const stored = await bioStore.get();
    if (!stored) return false;
    const ok = await promptBiometric("Connectez-vous à labConnect");
    if (!ok) return false;
    try {
      const deviceId = await getDeviceId();
      await api.biometricLogin({
        phone: stored.phone,
        deviceId,
        deviceToken: stored.token,
      });
      rememberIdentifier(stored.phone);
      setLoading(true);
      await hydrate();
      return true;
    } catch (e) {
      // Si le serveur dit "invalid_device" → device révoqué, on purge.
      if (e?.status === 401) await bioStore.clear();
      throw e;
    }
  }, [hydrate]);

  /**
   * Active le login biométrique sur cet appareil. À appeler juste après
   * une session OTP réussie, quand l'utilisateur accepte d'activer
   * Face ID. Suppose un access token déjà en place.
   */
  const enableBiometric = useCallback(async () => {
    const inspect = await inspectBiometric();
    if (!inspect.supported) {
      const msg = inspect.reason === "not_enrolled"
        ? "Aucune biométrie enrôlée sur l'appareil."
        : "Cet appareil ne supporte pas la biométrie.";
      const err = new Error(msg);
      err.code = inspect.reason;
      throw err;
    }
    const ok = await promptBiometric("Confirmez pour activer la reconnexion rapide");
    if (!ok) return false;
    const deviceId = await getDeviceId();
    const data = await api.biometricRegister({
      deviceId,
      deviceLabel: Platform.OS === "ios" ? "iPhone" : "Android",
      platform: Platform.OS,
    });
    await bioStore.save({ phone: data.phone, token: data.device_token });
    return true;
  }, []);

  /**
   * Désactive le login biométrique : purge le token local + révoque côté
   * serveur. Si l'appel serveur échoue (offline, token expiré...) on
   * efface quand même le local — l'utilisateur reverra l'OTP normal.
   */
  const disableBiometric = useCallback(async () => {
    const deviceId = await getDeviceId();
    try { await api.biometricRevoke(deviceId); } catch { /* ignore */ }
    await bioStore.clear();
  }, []);

  const updateProfile = useCallback(async (patch) => {
    const updated = await api.updateProfile(patch);
    setUser(updated);
    return updated;
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    // On NE purge PAS bioStore : la biométrie reste enregistrée sur
    // l'appareil, c'est tout le sens de la feature (reconnexion rapide
    // sans repasser par l'OTP).
  }, []);

  return (
    <AuthCtx.Provider value={{
      user, loading,
      loginWithPhone, loginWithEmail, loginWithGoogle, loginWithBiometric,
      enableBiometric, disableBiometric,
      updateProfile, logout, reload: hydrate,
    }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be inside <AuthProvider>");
  return ctx;
}
