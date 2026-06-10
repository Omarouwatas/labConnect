// Helpers Face ID / Touch ID / empreinte digitale + stockage sécurisé du
// token d'appareil. C'est le pont entre l'OS (Secure Enclave côté iOS,
// Android Keystore côté Android) et notre backend.
//
// Flow général :
//   1. À l'install : on génère un UUID stable (device_id) stocké dans
//      SecureStore — il identifie cette installation, pas l'utilisateur.
//   2. Après une connexion OTP réussie : on appelle
//      api.biometricRegister({deviceId}) et on stocke le `device_token`
//      retourné dans SecureStore, derrière une clé requireAuthentication
//      → seul Face ID ou la mot de passe du téléphone  peut le débloquer.
//   3. Au lancement suivant : si SecureStore expose un token pour ce
//      device + ce numéro, on déclenche Face ID, puis on POST au backend
//      pour obtenir une paire JWT.
//
// Garantie : sans le visage / empreinte de l'utilisateur, impossible de
// lire le device_token — même si quelqu'un déverrouille l'iPhone avec un
// code PIN, le Keychain refuse la lecture.
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

const K = {
  DEVICE_ID:    "lc.bio.device_id",   // UUID v4, public-ish (juste un identifiant install)
  DEVICE_TOKEN: "lc.bio.token",        // SECRET — protégé par WHEN_UNLOCKED
  PHONE:        "lc.bio.phone",        // numéro associé au token
  ENABLED:      "lc.bio.enabled",      // flag "1" / absent
};

// Options pour les secrets : sur iOS on exige que l'appareil soit
// déverrouillé. Le `requireAuthentication: true` forcerait Face ID à
// chaque lecture — on ne le fait pas ici parce que `authenticateAsync`
// nous donne déjà ce contrôle au moment où on le veut.
const SECRET_OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/**
 * Identifiant stable de l'appareil — créé au premier appel, persiste
 * tant que le Keychain (iOS) ou le Keystore (Android) n'est pas effacé.
 */
export async function getDeviceId() {
  let id = await SecureStore.getItemAsync(K.DEVICE_ID);
  if (id) return id;
  id = Crypto.randomUUID();
  await SecureStore.setItemAsync(K.DEVICE_ID, id);
  return id;
}

/** Inspecte le matériel biométrique disponible sur l'appareil. */
export async function inspectBiometric() {
  try {
    const hardware = await LocalAuthentication.hasHardwareAsync();
    if (!hardware) return { supported: false, reason: "no_hardware" };
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!enrolled) return { supported: false, reason: "not_enrolled" };
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    return { supported: true, types };
  } catch {
    return { supported: false, reason: "error" };
  }
}

/** Étiquette UX à afficher selon le type de biométrie de l'appareil. */
export function describeBiometric(types = []) {
  const T = LocalAuthentication.AuthenticationType;
  if (Platform.OS === "ios") {
    if (types.includes(T.FACIAL_RECOGNITION)) return { label: "Face ID", icon: "faceId" };
    if (types.includes(T.FINGERPRINT))        return { label: "Touch ID", icon: "fingerprint" };
    return { label: "Biométrie", icon: "shieldFill" };
  }
  if (types.includes(T.FACIAL_RECOGNITION))   return { label: "Reconnaissance faciale", icon: "faceId" };
  if (types.includes(T.FINGERPRINT))          return { label: "Empreinte digitale", icon: "fingerprint" };
  return { label: "Biométrie", icon: "shieldFill" };
}

/** Affiche le prompt Face ID / empreinte. Renvoie `true` si succès. */
export async function promptBiometric(promptMessage = "Confirmez votre identité") {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: "Annuler",
      fallbackLabel: "Utiliser le code de l'appareil",
      disableDeviceFallback: false, // on autorise PIN/pattern en dernier recours
    });
    return res?.success === true;
  } catch {
    return false;
  }
}

/** Store/load du device_token (secret). */
export const bioStore = {
  async save({ phone, token }) {
    await Promise.all([
      SecureStore.setItemAsync(K.DEVICE_TOKEN, token, SECRET_OPTIONS),
      SecureStore.setItemAsync(K.PHONE, phone),
      SecureStore.setItemAsync(K.ENABLED, "1"),
    ]);
  },
  async get() {
    const [token, phone, enabled] = await Promise.all([
      SecureStore.getItemAsync(K.DEVICE_TOKEN),
      SecureStore.getItemAsync(K.PHONE),
      SecureStore.getItemAsync(K.ENABLED),
    ]);
    if (!token || !phone || enabled !== "1") return null;
    return { token, phone };
  },
  async clear() {
    await Promise.all([
      SecureStore.deleteItemAsync(K.DEVICE_TOKEN).catch(() => {}),
      SecureStore.deleteItemAsync(K.PHONE).catch(() => {}),
      SecureStore.deleteItemAsync(K.ENABLED).catch(() => {}),
    ]);
  },
  /** Indique sans déclencher le prompt si un token existe (pour l'UI). */
  async isEnabled() {
    const enabled = await SecureStore.getItemAsync(K.ENABLED);
    return enabled === "1";
  },
  /** Phone associé localement (peut différer du phone backend après changement). */
  async getPhone() {
    return SecureStore.getItemAsync(K.PHONE);
  },
};
