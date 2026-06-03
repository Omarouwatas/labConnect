// Thin REST client pour le backend LabConnect (côté patient mobile).
// Stocke les tokens JWT dans AsyncStorage.
import AsyncStorage from "@react-native-async-storage/async-storage";

// Résolution intelligente de l'URL backend, par ordre de priorité :
//
//   1. EXPO_PUBLIC_API_BASE   (variable d'env explicite)
//   2. app.json extra.apiBase (config manuelle)
//   3. Auto-détection via Expo `hostUri` — utile pour appareil physique
//      sur LAN (iPhone qui scanne le QR code Expo Go) : on récupère l'IP
//      du Mac/PC depuis le manifest, et on remplace le port Metro (8081)
//      par le port Django (8000).
//   4. Fallback Android emulator (10.0.2.2)
//
// Comme ça, dans 95 % des cas l'utilisateur n'a RIEN à configurer :
// il lance `python manage.py runserver 0.0.0.0:8000` + `npx expo start`,
// scanne le QR, et l'app trouve toute seule le backend.
import Constants from "expo-constants";
import { Platform } from "react-native";

function autoDetectFromExpo() {
  // Expo SDK 54 expose `Constants.expoConfig.hostUri` au format
  // "192.168.1.5:8081" depuis le manifest du bundle. On garde
  // `expoGoConfig.debuggerHost` en filet de sécurité pour Expo Go.
  const hostUri =
    Constants?.expoConfig?.hostUri ||
    Constants?.expoGoConfig?.debuggerHost;
  if (!hostUri || typeof hostUri !== "string") return null;
  const host = hostUri.split(":")[0];
  if (!host) return null;
  return `http://${host}:8000/api/v1`;
}

const fallback = Platform.OS === "android"
  ? "http://10.0.2.2:8000/api/v1"     // émulateur Android
  : "http://localhost:8000/api/v1";   // iOS simulator / web

export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ||
  Constants?.expoConfig?.extra?.apiBase ||
  autoDetectFromExpo() ||
  fallback;

// Pratique pour debug : visible dans la console Metro au démarrage.
if (__DEV__) console.log("[labConnect] API_BASE =", API_BASE);

const K = { ACCESS: "lc.access", REFRESH: "lc.refresh" };

// Cache mémoire des tokens. AsyncStorage est asynchrone (~2-5 ms sur Android)
// et chaque requête API a besoin du token : sans cache, un écran qui lance
// plusieurs fetch parallèles paye cette latence sur chacun. On garde la
// source de vérité dans AsyncStorage (persistance) mais on évite de la
// lire en boucle après le premier accès.
let _access = null;
let _refresh = null;
let _loaded = false;

async function ensureLoaded() {
  if (_loaded) return;
  const [a, r] = await Promise.all([
    AsyncStorage.getItem(K.ACCESS),
    AsyncStorage.getItem(K.REFRESH),
  ]);
  _access = a;
  _refresh = r;
  _loaded = true;
}

export const tokens = {
  async getAccess()  { await ensureLoaded(); return _access; },
  async getRefresh() { await ensureLoaded(); return _refresh; },
  async set(access, refresh) {
    if (access)  { _access = access;   await AsyncStorage.setItem(K.ACCESS, access); }
    if (refresh) { _refresh = refresh; await AsyncStorage.setItem(K.REFRESH, refresh); }
    _loaded = true;
  },
  async clear() {
    _access = null;
    _refresh = null;
    _loaded = true;
    await AsyncStorage.multiRemove([K.ACCESS, K.REFRESH]);
  },
};

export class ApiError extends Error {
  constructor(status, code, detail, raw) {
    super(detail || code || `HTTP ${status}`);
    this.status = status; this.code = code; this.detail = detail; this.raw = raw;
  }
}

async function refreshAccessToken() {
  const refresh = await tokens.getRefresh();
  if (!refresh) return null;
  const res = await fetch(`${API_BASE}/auth/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  if (!res.ok) { await tokens.clear(); return null; }
  const data = await res.json();
  await tokens.set(data.access, refresh);
  return data.access;
}

/**
 * Déballe les réponses paginées DRF (`{count, results}`) en tableau plat,
 * et renvoie tel quel si la réponse est déjà un tableau.
 */
const asArray = (data) =>
  Array.isArray(data) ? data : (data?.results || []);

async function rawFetch(path, opts = {}, { retry = true } = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body !== undefined && !(opts.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const access = await tokens.getAccess();
  if (access) headers.Authorization = `Bearer ${access}`;

  const body =
    opts.body && !(opts.body instanceof FormData) && typeof opts.body !== "string"
      ? JSON.stringify(opts.body)
      : opts.body;

  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers, body });

  if (res.status === 401 && retry && (await tokens.getRefresh())) {
    const a = await refreshAccessToken();
    if (a) return rawFetch(path, opts, { retry: false });
  }

  if (res.status === 204) return null;
  const text = await res.text();
  const json = text ? safeParse(text) : null;
  if (!res.ok) {
    const err = json?.error || {};
    throw new ApiError(res.status, err.code, err.detail || res.statusText, json);
  }
  return json;
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

export const api = {
  get:    (p)        => rawFetch(p),
  post:   (p, body)  => rawFetch(p, { method: "POST", body }),
  patch:  (p, body)  => rawFetch(p, { method: "PATCH", body }),
  delete: (p)        => rawFetch(p, { method: "DELETE" }),
};

// ── Auth ────────────────────────────────────────────────────────────────────
// 2FA mockée : OTP request + verify acceptent n'importe quel code à 6 chiffres
// côté serveur (cf. accounts/tokens.py — `totp_verified=True` toujours).

export async function otpRequest(phone, purpose = "login") {
  return api.post("/auth/otp/request/", { phone, purpose, language: "fr" });
}

export async function otpVerify(phone, code, purpose = "login") {
  const data = await api.post("/auth/otp/verify/", { phone, code, purpose });
  await tokens.set(data.access, data.refresh);
  return data;
}

export async function emailLogin(email, password) {
  // Endpoint dédié patient/staff/mixte : aucun check de rôle, on accepte
  // tout user qui peut s'authentifier par email + mot de passe.
  const data = await api.post("/auth/login/email/", { email, password });
  await tokens.set(data.access, data.refresh);
  return data;
}

export async function googleLogin(idToken) {
  // Auto-création du patient à la première connexion Google.
  const data = await api.post("/auth/login/google/patient/", { id_token: idToken });
  await tokens.set(data.access, data.refresh);
  return data;
}

export async function updateProfile({ first_name, last_name, email, preferred_language }) {
  const payload = {};
  if (first_name !== undefined) payload.first_name = first_name;
  if (last_name !== undefined) payload.last_name = last_name;
  if (email !== undefined) payload.email = email;
  if (preferred_language !== undefined) payload.preferred_language = preferred_language;
  return api.patch("/auth/me/", payload);
}

export const logout = async () => {
  try {
    const refresh = await tokens.getRefresh();
    if (refresh) await api.post("/auth/logout/", { refresh });
  } catch { /* ignore */ }
  await tokens.clear();
};

export const fetchMe = () => api.get("/auth/me/");

// ── Labs / catalogue (public) ───────────────────────────────────────────────

export const fetchLabs       = ()          => api.get("/laboratories/").then(asArray);
export const fetchLab        = (uuid)      => api.get(`/laboratories/${uuid}/`);
export const fetchLabsNearby = (lat, lng, radiusKm = 20) =>
  api.get(`/laboratories/nearby/?lat=${lat}&lng=${lng}&radius_km=${radiusKm}`).then(asArray);

export const fetchLabCatalog = (labUuid)   => api.get(`/lab/catalog/?lab=${labUuid}`).then(asArray);

// ── Appointments ────────────────────────────────────────────────────────────

export const fetchMyAppointments = () => api.get("/appointments/mine/").then(asArray);

export async function createAppointment({
  laboratoryUuid, visitType, scheduledFor, homeAddress, notes,
  testUuids, prerequisiteAnswers, cnamUsed,
}) {
  // testUuids et prerequisiteAnswers sont optionnels — si fournis, le
  // backend crée atomiquement Sample + TestOrder par test choisi (split
  // CNAM appliqué automatiquement depuis le profil patient). Sans, on
  // garde l'ancien comportement (Appointment vide, tests dans les notes).
  //
  // `cnamUsed` est un hint que le patient veut utiliser sa CNAM pour ce
  // RDV — le backend applique alors le pourcentage de couverture de son
  // profil. Le serveur reste source de vérité du calcul final.
  return api.post("/appointments/", {
    laboratory_uuid: laboratoryUuid,
    visit_type: visitType, // in_lab | home | emergency
    scheduled_for: scheduledFor,
    home_address: homeAddress || "",
    notes: notes || "",
    test_uuids: testUuids && testUuids.length ? testUuids : undefined,
    prerequisite_answers:
      prerequisiteAnswers && Object.keys(prerequisiteAnswers).length
        ? prerequisiteAnswers
        : undefined,
    cnam_used: cnamUsed !== undefined ? !!cnamUsed : undefined,
  });
}

// ── Results ─────────────────────────────────────────────────────────────────

export const fetchMyResults = () => api.get("/results/mine/").then(asArray);
