// Canonical role identifiers — must match Django Group names in the backend
export const ROLES = {
  LAB_CHIEF:  "lab_chief",
  BIOLOGIST:  "biologist",
  TECHNICIAN: "technician",
  NURSE:      "nurse",
  SECRETARY:  "secretary",
  PATIENT:    "patient",
};

export const ROLE_LABELS = {
  lab_chief:  "Chef de laboratoire",
  biologist:  "Biologiste",
  technician: "Technicien(ne)",
  nurse:      "Infirmier(ère)",
  secretary:  "Secrétaire médicale",
  patient:    "Patient",
};

export const ROLE_AVATARS = {
  lab_chief:  "a1",
  biologist:  "a2",
  technician: "a3",
  nurse:      "a4",
  secretary:  "a6",
  patient:    "a5",
};

// Web app only manages staff roles (livreur is mobile)
export const STAFF_ROLES_FOR_WEB = [
  ROLES.LAB_CHIEF,
  ROLES.BIOLOGIST,
  ROLES.TECHNICIAN,
  ROLES.NURSE,
  ROLES.SECRETARY,
];

// Roles assignable via the employee management API. Chef de labo n'est jamais
// assigné via cette API (un chef se crée via `manage.py create_chef`).
// Mirroir du `_ASSIGNABLE_ROLES` backend dans `accounts/views_employees.py`.
export const ASSIGNABLE_ROLES = STAFF_ROLES_FOR_WEB.filter(
  (r) => r !== ROLES.LAB_CHIEF,
);

// Per-role permission atoms. The UI computes the UNION of these atoms
// across every role the user holds — so a user who is both biologiste and
// technicien really can enter AND validate results from the same session,
// without having to toggle a "current role" pseudo-context.
const ATOMS_BY_ROLE = {
  [ROLES.LAB_CHIEF]: {
    editTests:    true,
    editStaff:    true,
    editSettings: true,
    viewFinance:  true,
    validate:     true,
    enterResult:  true,
    createSample: true,
  },
  [ROLES.BIOLOGIST]: {
    viewFinance:  true,
    validate:     true,
    enterResult:  true,
  },
  [ROLES.TECHNICIAN]: {
    enterResult:  true,
    // Un·e technicien·ne peut aussi enregistrer un patient au comptoir
    // (cas des petits labos où une seule personne fait l'accueil + la
    // paillasse). Le backend WalkInView autorise le même rôle.
    createSample: true,
  },
  [ROLES.NURSE]: {
    createSample: true,
  },
  [ROLES.SECRETARY]: {
    createSample: true,
  },
};

const EMPTY_PERMS = {
  editTests: false, editStaff: false, editSettings: false,
  viewFinance: false, validate: false, enterResult: false, createSample: false,
};

/**
 * Compute the union of permission atoms across all roles the user holds.
 *
 * Accepts either a single role string (legacy) or an array of role strings.
 * Returns a fully-populated permissions object (every atom defaulted to false).
 */
export function permissionsFor(roles) {
  const arr = Array.isArray(roles) ? roles : (roles ? [roles] : []);
  const result = { ...EMPTY_PERMS };
  for (const r of arr) {
    const atoms = ATOMS_BY_ROLE[r];
    if (!atoms) continue;
    for (const [k, v] of Object.entries(atoms)) {
      if (v) result[k] = true;
    }
  }
  return result;
}

/**
 * Pick the user's "primary" role — used purely for visual cues (avatar
 * color, default landing screen, chip label). It does NOT restrict
 * permissions: those always come from the union via `permissionsFor`.
 *
 * Priority order: lab_chief > biologist > technician > nurse > secretary.
 */
const ROLE_PRIORITY = [
  ROLES.LAB_CHIEF, ROLES.BIOLOGIST, ROLES.TECHNICIAN, ROLES.NURSE, ROLES.SECRETARY,
];
export function primaryRole(roles) {
  const arr = Array.isArray(roles) ? roles : (roles ? [roles] : []);
  for (const r of ROLE_PRIORITY) if (arr.includes(r)) return r;
  return arr[0] || null;
}

// Test catalog categories — UI grouping derived from the SampleType backend enum
export const CATEGORIES = [
  { id: "blood",  name: "Sang",          color: "rose"   },
  { id: "urine",  name: "Urine",         color: "amber"  },
  { id: "stool",  name: "Selles",        color: "green"  },
  { id: "saliva", name: "Salive",        color: "blue"   },
  { id: "swab",   name: "Prélèvement",   color: "orange" },
  { id: "other",  name: "Autre",         color: "blue"   },
];

export const TAT_OPTIONS = [1, 2, 3, 6, 12, 24, 48, 72];

// ── Mauritania settings ─────────────────────────────────────────────────
export const CURRENCY = {
  code: "MRU",
  symbol: "UM",
  // Affichage : "1 800 UM"
  format(n) {
    return `${Number(n || 0).toLocaleString("fr-FR")} ${this.symbol}`;
  },
};

// Centre Nouakchott (Mauritanie)
export const DEFAULT_LOCATION = { lat: 18.0735, lng: -15.9582 };
export const DEFAULT_COUNTRY = "Mauritanie";
export const DEFAULT_CITY = "Nouakchott";

// Suggestions de tests courants pour l'auto-remplissage du modal "Ajouter un test"
export const TEST_PRESETS = [
  { code: "NFS",   name: "Numération formule sanguine",        sample_type: "blood",  price_mru: 1800, turnaround_hours: 2,  requires_fasting: false },
  { code: "GLY",   name: "Glycémie à jeun",                    sample_type: "blood",  price_mru: 600,  turnaround_hours: 1,  requires_fasting: true  },
  { code: "TSH",   name: "Thyréostimuline (TSH)",              sample_type: "blood",  price_mru: 2400, turnaround_hours: 24, requires_fasting: false },
  { code: "CRP",   name: "Protéine C-réactive",                sample_type: "blood",  price_mru: 1500, turnaround_hours: 3,  requires_fasting: false },
  { code: "ECBU",  name: "Examen cyto-bactériologique urines", sample_type: "urine",  price_mru: 1900, turnaround_hours: 48, requires_fasting: false },
  { code: "VITD",  name: "Vitamine D (25-OH)",                 sample_type: "blood",  price_mru: 3200, turnaround_hours: 48, requires_fasting: false },
  { code: "BHCG",  name: "β-HCG quantitatif",                  sample_type: "blood",  price_mru: 2100, turnaround_hours: 24, requires_fasting: false },
  { code: "FERR",  name: "Ferritine",                           sample_type: "blood",  price_mru: 1700, turnaround_hours: 24, requires_fasting: false },
  { code: "CHOL",  name: "Cholestérol total",                  sample_type: "blood",  price_mru: 900,  turnaround_hours: 3,  requires_fasting: true  },
  { code: "HBA1C", name: "Hémoglobine glyquée (HbA1c)",        sample_type: "blood",  price_mru: 2500, turnaround_hours: 24, requires_fasting: false },
  { code: "UREA",  name: "Urée sanguine",                       sample_type: "blood",  price_mru: 700,  turnaround_hours: 3,  requires_fasting: false },
  { code: "CREA",  name: "Créatinine",                          sample_type: "blood",  price_mru: 800,  turnaround_hours: 3,  requires_fasting: false },
  { code: "AST",   name: "ASAT (transaminase)",                 sample_type: "blood",  price_mru: 900,  turnaround_hours: 6,  requires_fasting: false },
  { code: "ALT",   name: "ALAT (transaminase)",                 sample_type: "blood",  price_mru: 900,  turnaround_hours: 6,  requires_fasting: false },
  { code: "PCR",   name: "PCR respiratoire (multiplex)",        sample_type: "swab",   price_mru: 12000, turnaround_hours: 24, requires_fasting: false },
  { code: "COVID", name: "SARS-CoV-2 (PCR)",                    sample_type: "swab",   price_mru: 8000, turnaround_hours: 12, requires_fasting: false },
  { code: "STOOL", name: "Examen parasitologique des selles",   sample_type: "stool",  price_mru: 1400, turnaround_hours: 48, requires_fasting: false },
];

export function initials(name) {
  if (!name) return "?";
  const parts = name.replace(/^Dr\.?\s+/i, "").split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "?";
}

export function avatarClassFor(seed) {
  if (!seed) return "a1";
  const s = String(seed);
  const sum = [...s].reduce((a, c) => a + c.charCodeAt(0), 0);
  return ["a1", "a2", "a3", "a4", "a5", "a6"][sum % 6];
}
