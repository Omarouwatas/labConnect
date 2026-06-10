// Thin fetch wrapper around the LabConnect backend.
//
// Tokens are stored in localStorage under:
//   lc.access  — JWT access token
//   lc.refresh — JWT refresh token

const BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000/api/v1";

// Origin servant les fichiers media (logos, etc.) — même hôte que l'API,
// sans le préfixe `/api/v1`. Exposé pour que les écrans construisent
// `${MEDIA_BASE}${lab.logo}` sans réinventer la dérivation.
export const MEDIA_BASE = BASE.replace(/\/api\/v1\/?$/, "");

/**
 * Déballe les réponses paginées DRF (`{count, results}`) en tableau plat,
 * et renvoie tel quel si la réponse est déjà un tableau. Évite à chaque
 * écran de re-tester `Array.isArray(data) ? data : data?.results || []`.
 */
export const asArray = (data) =>
  Array.isArray(data) ? data : (data?.results || []);

/** Construit une URL absolue vers un fichier media (logo, etc.). */
export const mediaUrl = (path) => {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${MEDIA_BASE}${path}`;
};

const STORAGE = {
  ACCESS:  "lc.access",
  REFRESH: "lc.refresh",
  LAB:     "lc.lab",
};

export const labScope = {
  get uuid() { return localStorage.getItem(STORAGE.LAB); },
  set(uuid)  { if (uuid) localStorage.setItem(STORAGE.LAB, uuid); else localStorage.removeItem(STORAGE.LAB); },
};

export const tokens = {
  get access()  { return localStorage.getItem(STORAGE.ACCESS); },
  get refresh() { return localStorage.getItem(STORAGE.REFRESH); },
  set(access, refresh) {
    if (access)  localStorage.setItem(STORAGE.ACCESS,  access);
    if (refresh) localStorage.setItem(STORAGE.REFRESH, refresh);
  },
  clear() {
    localStorage.removeItem(STORAGE.ACCESS);
    localStorage.removeItem(STORAGE.REFRESH);
  },
};

export class ApiError extends Error {
  constructor(status, code, detail, raw) {
    super(detail || code || `HTTP ${status}`);
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.raw = raw;
  }
}

async function refreshAccessToken() {
  const refresh = tokens.refresh;
  if (!refresh) return null;
  const res = await fetch(`${BASE}/auth/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  if (!res.ok) {
    tokens.clear();
    return null;
  }
  const data = await res.json();
  tokens.set(data.access, refresh);
  return data.access;
}

async function rawFetch(path, opts = {}, { retry = true } = {}) {
  const headers = { ...(opts.headers || {}) };
  if (!(opts.body instanceof FormData) && opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (tokens.access) headers.Authorization = `Bearer ${tokens.access}`;
  if (labScope.uuid && !headers["X-Lab-Uuid"]) headers["X-Lab-Uuid"] = labScope.uuid;

  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers,
    body: opts.body && !(opts.body instanceof FormData) && typeof opts.body !== "string"
      ? JSON.stringify(opts.body)
      : opts.body,
  });

  if (res.status === 401 && retry && tokens.refresh) {
    const newAccess = await refreshAccessToken();
    if (newAccess) {
      return rawFetch(path, opts, { retry: false });
    }
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

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

export const api = {
  get:    (p)        => rawFetch(p),
  post:   (p, body)  => rawFetch(p, { method: "POST", body }),
  patch:  (p, body)  => rawFetch(p, { method: "PATCH", body }),
  put:    (p, body)  => rawFetch(p, { method: "PUT", body }),
  delete: (p)        => rawFetch(p, { method: "DELETE" }),
};

// ── Auth ────────────────────────────────────────────────────────────────────

export async function staffLogin(email, password) {
  const data = await api.post("/auth/login/staff/", { email, password });
  tokens.set(data.access, data.refresh);
  return data;
}

export async function googleLogin(idToken) {
  const data = await api.post("/auth/login/google/", { id_token: idToken });
  tokens.set(data.access, data.refresh);
  return data;
}

export async function logout() {
  try {
    if (tokens.refresh) {
      await api.post("/auth/logout/", { refresh: tokens.refresh });
    }
  } catch { /* ignore */ }
  tokens.clear();
}

export const fetchMe = () => api.get("/auth/me/");

// ── Labs (multi-lab) ────────────────────────────────────────────────────────

export const fetchMyLabs     = ()      => api.get("/lab/mine/").then(asArray);
export const createLab       = (body)  => api.post("/lab/mine/", body);
export const fetchLabConfig  = ()      => api.get("/lab/config");
export const patchLabConfig  = (body)  => api.patch("/lab/config", body);

// Upload du logo — multipart/form-data (le rawFetch detecte FormData et
// laisse le navigateur fixer le boundary correctement).
export async function uploadLabLogo(file) {
  const fd = new FormData();
  fd.append("logo", file);
  return api.patch("/lab/config", fd);
}

// ── Geocoding (Nominatim / OpenStreetMap, public) ───────────────────────────

export async function geocode(query, { countrycodes = "mr" } = {}) {
  const params = new URLSearchParams({
    q: query, format: "json", addressdetails: "1", countrycodes, limit: "5",
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "Accept": "application/json" },
  });
  if (!res.ok) return [];
  return res.json();
}

export async function reverseGeocode(lat, lng) {
  const params = new URLSearchParams({
    lat: String(lat), lon: String(lng),
    format: "json", addressdetails: "1", zoom: "16",
  });
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

// ── Catalog (tests) ─────────────────────────────────────────────────────────

export const fetchCatalog    = ()        => api.get("/lab/catalog/").then(asArray);
export const createTest      = (body)    => api.post("/lab/catalog/", body);
export const updateTest      = (uuid, b) => api.patch(`/lab/catalog/${uuid}/`, b);
export const deleteTest      = (uuid)    => api.delete(`/lab/catalog/${uuid}/`);

// ── Employees / staff ───────────────────────────────────────────────────────

export const fetchEmployees  = ()        => api.get("/lab/employees/").then(asArray);
export const inviteEmployee  = (body)    => api.post("/lab/employees/invite", body);
export const updateEmployee  = (uuid, b) => api.patch(`/lab/employees/${uuid}/`, b);
export const deactivateEmployee = (uuid) => api.delete(`/lab/employees/${uuid}/`);

// ── Orders / samples / results (dashboard + analyses screen) ───────────────

export const fetchOrders        = (params = "") => api.get(`/lab/orders/${params}`).then(asArray);
export const fetchSamples       = (params = "") => api.get(`/lab/samples/${params}`).then(asArray);
export const fetchAppointments  = (params = "") => api.get(`/appointments/${params}`).then(asArray);

// ── Tournées (visites à domicile + affectation infirmière) ───────────────
// Helpers consommés par l'écran « Tournées ».
//   - fetchHomeVisits : accepte les query params backend :
//       scope=mine|all  (défaut : mine pour nurse seule, all pour
//                        secretary/chef)
//       unassigned=1    (uniquement les visites sans nurse)
//       date=YYYY-MM-DD (filtre par jour)
//       include_done=1  (inclut les visites completed)
//   - fetchNurses     : sélecteur d'affectation (staff 2FA).
//   - assignNurse     : PATCH /appointments/{uuid}/assign-nurse/.
//                      Passer null pour désassigner.
//   - changeApptStatus: PATCH /appointments/{uuid}/status/ (start/finish).
export const fetchHomeVisits   = (params = "") => api.get(`/appointments/home-visits/${params}`).then(asArray);
export const fetchNurses       = ()             => api.get("/lab/nurses/").then(asArray);
export const assignNurse       = (apptUuid, nurseUuid) =>
  api.patch(`/appointments/${apptUuid}/assign-nurse/`, { nurse_uuid: nurseUuid });
export const changeApptStatus  = (apptUuid, status, extra = {}) =>
  api.patch(`/appointments/${apptUuid}/status/`, { status, ...extra });

// Detail / write actions on a single order
export const fetchOrderResult   = (uuid)        => api.get(`/lab/orders/${uuid}/result/`);
export const enterResult        = (uuid, body)  => api.post(`/lab/orders/${uuid}/result/`, body);
export const validateResult     = (uuid, body)  => api.patch(`/lab/orders/${uuid}/result/`, body);

// Sample lifecycle (technician / nurse)
export const receiveSample      = (uuid)        => api.patch(`/lab/samples/${uuid}/receive/`, {});
export const rejectSample       = (uuid, reason)=> api.patch(`/lab/samples/${uuid}/reject/`, { reason });

// Walk-in : un staff (secrétaire/infirmier/chef) crée une analyse pour un
// patient présent au labo, sans qu'il ait l'app mobile. Le backend gère
// atomiquement : find-or-create patient + Appointment + Sample + TestOrders.
export const createWalkIn       = (body)        => api.post("/lab/walk-in/", body);

// Facture détaillée d'un RDV — items par test, splits CNAM, totaux. Utilisé
// par l'écran "Voir la facture" depuis la file validée.
export const fetchInvoice       = (apptUuid)    => api.get(`/lab/invoices/${apptUuid}/`);

// Stats agrégées sur une fenêtre glissante (jours). Le backend filtre
// les agrégats financiers selon le rôle — on s'attend à ce que `revenue_mru`
// etc. soient `null` pour un technicien.
export const fetchStats         = (days = 7)    => api.get(`/lab/stats/?days=${days}`);

// ── Inventaire (chef de labo + chiffres pour stats) ────────────────────
export const fetchInventory       = ()              => api.get("/lab/inventory/").then(asArray);
export const createInventoryItem  = (body)          => api.post("/lab/inventory/", body);
export const updateInventoryItem  = (uuid, body)    => api.patch(`/lab/inventory/${uuid}/`, body);
export const deleteInventoryItem  = (uuid)          => api.delete(`/lab/inventory/${uuid}/`);
export const postInventoryMove    = (uuid, body)    => api.post(`/lab/inventory/${uuid}/movement/`, body);
export const fetchInventoryMoves  = (uuid)          => api.get(`/lab/inventory/${uuid}/movements/`).then(asArray);

// ── Notifications staff ────────────────────────────────────────────────
// Mêmes endpoints que côté mobile patient — on s'abstient de filtrer
// côté client : c'est le backend qui ne renvoie que les notifs du
// `request.user` connecté. Le staff voit ses propres notifs (à valider,
// nouveau RDV reçu, etc.).
export const fetchNotifications        = (params = "")  => api.get(`/notifications/mine/${params}`);
export const fetchUnreadCount          = ()             => api.get("/notifications/unread/").then((r) => r?.unread || 0);
export const markNotificationRead      = (uuid)         => api.patch(`/notifications/${uuid}/read/`);
export const markAllNotificationsRead  = ()             => api.post("/notifications/read-all/", {});

// PDF d'un résultat validé — accès patient OU staff du labo. Le
// composant InvoiceModal peut désormais aussi proposer le PDF result.
export const resultPdfUrl = (orderUuid) =>
  `${import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000/api/v1"}/lab/orders/${orderUuid}/result/pdf/`;
