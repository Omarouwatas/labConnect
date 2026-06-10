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

/**
 * Patch le profil utilisateur (User + PatientProfile à plat).
 *
 * Les champs reconnus côté backend :
 *   User             : first_name, last_name, email, preferred_language
 *   PatientProfile   : cnam_number, cnam_coverage_pct, date_of_birth (YYYY-MM-DD),
 *                      gender, blood_type, emergency_contact, default_address,
 *                      default_latitude, default_longitude
 *
 * On accepte n'importe quel subset — les champs absents (undefined) ne
 * sont pas envoyés. Pour vider une valeur, passer "" ou null explicitement.
 */
export async function updateProfile(patch = {}) {
  const allowed = [
    "first_name", "last_name", "email", "preferred_language",
    "cnam_number", "cnam_coverage_pct",
    "date_of_birth", "gender", "blood_type",
    "emergency_contact", "default_address",
    "default_latitude", "default_longitude",
  ];
  const payload = {};
  for (const k of allowed) {
    if (patch[k] !== undefined) payload[k] = patch[k];
  }
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

// ── Biométrie (Face ID / empreinte) ────────────────────────────────────────
// Couplée à un appareil unique (device_id). Le `device_token` n'est délivré
// qu'après une session OTP réussie. Voir src/biometric.js pour le stockage
// local sécurisé.

/** Pré-check : ce couple (phone, device_id) a-t-il un appareil de confiance ? */
export const biometricCheck = (phone, deviceId) =>
  api.post("/auth/biometric/check/", { phone, device_id: deviceId });

/** Demande au backend un device_token (requiert d'être déjà authentifié). */
export const biometricRegister = ({ deviceId, deviceLabel, platform }) =>
  api.post("/auth/biometric/register/", {
    device_id: deviceId,
    device_label: deviceLabel || "",
    platform: platform || "",
  });

/** Échange un (phone, device_id, device_token) contre une paire JWT. */
export async function biometricLogin({ phone, deviceId, deviceToken }) {
  const data = await api.post("/auth/biometric/login/", {
    phone,
    device_id: deviceId,
    device_token: deviceToken,
  });
  await tokens.set(data.access, data.refresh);
  return data;
}

/** Révoque cet appareil côté serveur (auth requise). */
export const biometricRevoke = (deviceId) =>
  api.post("/auth/biometric/revoke/", { device_id: deviceId });

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
  homeLatitude, homeLongitude,
}) {
  // testUuids et prerequisiteAnswers sont optionnels — si fournis, le
  // backend crée atomiquement Sample + TestOrder par test choisi (split
  // CNAM appliqué automatiquement depuis le profil patient). Sans, on
  // garde l'ancien comportement (Appointment vide, tests dans les notes).
  //
  // `cnamUsed` est un hint que le patient veut utiliser sa CNAM pour ce
  // RDV — le backend applique alors le pourcentage de couverture de son
  // profil. Le serveur reste source de vérité du calcul final.
  //
  // `homeLatitude`/`homeLongitude` sont captés par le CartScreen quand
  // l'utilisateur tape « Utiliser ma position » — le backend les compose
  // dans `Appointment.home_location` (PointField) pour la carte de
  // tournée infirmière.
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
    home_latitude: typeof homeLatitude === "number" ? homeLatitude : undefined,
    home_longitude: typeof homeLongitude === "number" ? homeLongitude : undefined,
  });
}

// ── Results ─────────────────────────────────────────────────────────────────

export const fetchMyResults = () => api.get("/results/mine/").then(asArray);

// ── Nurse / tournée à domicile ──────────────────────────────────────────────
// Helpers pour l'app infirmier·e mobile :
//   - fetchMyVisits()    : liste des visites à domicile assignées à
//                          l'utilisateur·trice connecté·e (scope=mine).
//                          Le backend filtre déjà sur assigned_nurse=user
//                          pour le rôle nurse seul, mais on passe le
//                          paramètre explicitement pour rester clair.
//   - startVisit(uuid)   : PATCH status → in_progress, ce qui déclenche
//                          la cascade backend (samples reçus, orders
//                          en in_progress). Le prélèvement est ainsi
//                          tracé dès que l'infirmière démarre.
//   - completeVisit(u)   : PATCH status → completed. La visite quitte
//                          la file active.
//   - checkInVisit(u)    : transition optionnelle pending → checked_in
//                          (« patient rencontré ») avant le prélèvement.
//
// `include_done=1` fait remonter aussi les visites terminées du jour
// (utile pour le compteur et l'historique).
export const fetchMyVisits = (params = "?scope=mine&include_done=1") =>
  api.get(`/appointments/home-visits/${params}`).then(asArray);

export const startVisit    = (uuid) =>
  api.patch(`/appointments/${uuid}/status/`, { status: "in_progress" });
export const completeVisit = (uuid) =>
  api.patch(`/appointments/${uuid}/status/`, { status: "completed" });
export const checkInVisit  = (uuid) =>
  api.patch(`/appointments/${uuid}/status/`, { status: "checked_in" });

// Détail d'un RDV (équivalent côté nurse de fetchMyAppointments mais
// pour un seul UUID). Sert à NurseMissionScreen pour avoir les `items`
// (= tests à prélever) complets sans dépendre du payload de la liste.
export const fetchAppointment = (uuid) =>
  api.get(`/appointments/${uuid}/`);

/**
 * Enregistre le code-barre des tubes physiquement utilisés.
 *
 * `tubes` est une map `{ order_uuid: "barcode" }`. Les ordres absents
 * de la map sont laissés tels quels côté backend — utile pour soumettre
 * en batch à la fin du prélèvement ou par tube au fur et à mesure.
 */
export const saveTubes = (apptUuid, tubes) =>
  api.patch(`/appointments/${apptUuid}/tubes/`, { tubes });

// ── Notifications ──────────────────────────────────────────────────────────
//
// Endpoints :
//   GET    /notifications/mine/?unread=1&limit=N  → { results: [...], unread }
//   GET    /notifications/unread/                 → { unread }
//   PATCH  /notifications/{uuid}/read/            → notif mise à jour
//   POST   /notifications/read-all/               → { marked }
//
// La cloche poll `unread` (léger) toutes les 30 s ; l'écran centre fetch
// `mine` au focus. Pas de WebSocket — l'app patient n'en a pas besoin
// dans ce contexte démo.
export const fetchNotifications = (params = "") =>
  api.get(`/notifications/mine/${params}`);
export const fetchUnreadCount   = () =>
  api.get("/notifications/unread/").then((r) => r?.unread || 0);
export const markNotificationRead = (uuid) =>
  api.patch(`/notifications/${uuid}/read/`);
export const markAllNotificationsRead = () =>
  api.post("/notifications/read-all/");

// ── PDF du résultat ────────────────────────────────────────────────────────
// L'URL est servie en mode authentifié (Bearer). Le client la fetch
// manuellement (avec `fetchPdfBlob` ci-dessous) puis l'enregistre dans le
// cache local pour l'ouvrir/partager. C'est plus robuste que de coller
// un token en query string, qui fuirait dans les logs serveur.
export const resultPdfUrl = (orderUuid) =>
  `${API_BASE}/lab/orders/${orderUuid}/result/pdf/`;

/**
 * Télécharge le PDF du résultat. Renvoie un Blob (web) ou la string
 * base64 (mobile, via res.text() + conversion). Pour Expo, on s'appuie
 * sur `expo-file-system` côté UI plutôt que d'inventer un blob ici.
 */
export async function fetchResultPdfBytes(orderUuid) {
  const access = await tokens.getAccess();
  const res = await fetch(resultPdfUrl(orderUuid), {
    headers: access ? { Authorization: `Bearer ${access}` } : {},
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, "pdf_unavailable", text || res.statusText, null);
  }
  return res.arrayBuffer();
}
