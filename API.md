# labConnect — API reference

Base URL : `http://127.0.0.1:8000/api/v1`

Tous les endpoints retournent du JSON et acceptent du JSON en entrée (sauf upload
de fichiers — `multipart/form-data`). Les erreurs respectent la forme :

```json
{ "error": { "code": "invalid_credentials", "detail": "Email ou mot de passe incorrect" } }
```

## Authentification

L'API utilise des JWT signés (`rest_framework_simplejwt`). Deux tokens :

- `access`  — court (≈ 15 min). À envoyer dans l'en-tête `Authorization`.
- `refresh` — long (≈ 7 jours). Sert à renouveler l'`access` sans ressaisie.

```http
Authorization: Bearer <access_token>
```

Chaque `access` inclut :

| Claim            | Type     | Description                                                   |
| ---------------- | -------- | ------------------------------------------------------------- |
| `user_id`        | int      | PK du `User`.                                                 |
| `roles`          | string[] | Noms des `Group` Django auxquels l'utilisateur appartient.    |
| `totp_verified`  | bool     | **Mocké à `true` en démo** (voir `accounts/tokens.py`).       |

### Rôles canoniques

| ID Django Group | Libellé               | Périmètre                                                |
| --------------- | --------------------- | -------------------------------------------------------- |
| `lab_chief`     | Chef de laboratoire   | Configuration du labo, staff, catalogue, validation     |
| `biologist`     | Biologiste            | Validation des résultats, lecture finance               |
| `technician`    | Technicien(ne)        | Saisie des résultats, lecture limitée                   |
| `nurse`         | Infirmier(ère)        | Visites à domicile, prélèvements                        |
| `secretary`     | Secrétaire médicale   | Prise de RDV, création d'échantillons                   |
| `patient`       | Patient               | Espace patient (mobile)                                 |

> **Multi-rôles** : un même utilisateur peut cumuler plusieurs rôles
> (ex. un biologiste qui est aussi technicien). Les permissions sont l'union
> de tous les rôles. Le `Group` `lab_chief` n'est jamais assigné via l'API
> staff — il se fixe via l'admin Django.

---

## Table des matières

- [Auth](#auth)
  - POST `/auth/otp/request/`
  - POST `/auth/otp/verify/`
  - POST `/auth/login/staff/`
  - POST `/auth/login/google/`
  - POST `/auth/login/google/patient/`
  - POST `/auth/login/firebase/`
  - POST `/auth/refresh/`
  - POST `/auth/logout/`
  - GET / PATCH `/auth/me/`
  - POST `/auth/totp/setup/` *(mocké)*
  - POST `/auth/totp/confirm/` *(mocké)*
  - POST `/auth/totp/verify/` *(mocké)*
  - DELETE `/auth/totp/device/`
- [Laboratoires](#laboratoires)
  - GET `/laboratories/`
  - GET `/laboratories/{uuid}/`
  - GET `/laboratories/nearby/`
  - GET / PATCH `/lab/config`
- [Personnel](#personnel)
  - POST `/lab/employees/invite`
  - GET `/lab/employees/`
  - GET `/lab/employees/{uuid}/`
  - PATCH `/lab/employees/{uuid}/`
  - DELETE `/lab/employees/{uuid}/`
- [Catalogue de tests](#catalogue-de-tests)
  - GET / POST `/lab/catalog/`
  - GET / PATCH / DELETE `/lab/catalog/{uuid}/`
- [Échantillons](#échantillons)
  - GET / POST `/lab/samples/`
  - PATCH `/lab/samples/{uuid}/receive/`
  - PATCH `/lab/samples/{uuid}/reject/`
  - POST `/lab/walk-in/`
  - GET `/lab/invoices/{appointment_uuid}/`
  - GET `/lab/stats/`
  - GET / POST `/lab/inventory/`
  - PATCH / DELETE `/lab/inventory/{uuid}/`
  - POST `/lab/inventory/{uuid}/movement/`
  - GET `/lab/inventory/{uuid}/movements/`
- [Ordres & résultats](#ordres--résultats)
  - GET `/lab/orders/`
  - GET / POST / PATCH `/lab/orders/{uuid}/result/`
  - GET `/results/mine/`
- [Rendez-vous](#rendez-vous)
  - GET / POST `/appointments/`
  - GET `/appointments/mine/`
  - GET `/appointments/home-visits/`
  - PATCH `/appointments/{uuid}/cancel/`
  - PATCH `/appointments/{uuid}/status/`

---

## Auth

### `POST /auth/otp/request/`  *(public)*

Envoie un OTP par SMS au numéro fourni.

**Auth** : aucune.

**Body**
```json
{
  "phone": "+213555123456",
  "purpose": "login",
  "language": "fr"
}
```
`purpose` ∈ `login | register | password_reset | verify_phone`.

**Réponse 200**
```json
{ "sent": true, "ttl_seconds": 300 }
```

---

### `POST /auth/otp/verify/`  *(public)*

Vérifie l'OTP et retourne une paire JWT. Crée le `User` s'il n'existe pas
(rôle `patient` auto-assigné).

**Auth** : aucune.

**Body**
```json
{
  "phone": "+213555123456",
  "code": "493012",
  "purpose": "login"
}
```

**Réponse 200**
```json
{
  "access": "eyJ0eXAiOi...",
  "refresh": "eyJ0eXAiOi...",
  "user": {
    "uuid": "8f6e...",
    "phone": "+213555123456",
    "email": null,
    "first_name": "",
    "last_name": "",
    "preferred_language": "fr",
    "is_phone_verified": true,
    "roles": ["patient"]
  }
}
```

---

### `POST /auth/login/staff/`  *(public)*

Connexion staff par email + mot de passe.

**Auth** : aucune.

**Body**
```json
{ "email": "chef.labo@labconnect.dz", "password": "admin1234" }
```

**Réponse 200** — identique à `/auth/otp/verify/`.
**Réponses d'erreur** : `400 invalid_credentials`, `403 access_denied`
(compte non staff).

> **Note 2FA** : en mode démo, le token retourné a déjà `totp_verified: true`.

---

### `POST /auth/login/google/`  *(public)*

Connexion staff via un Google ID Token (le compte doit déjà exister côté serveur).

**Body**
```json
{ "id_token": "<google-id-token>" }
```

**Réponse** : identique à `/auth/login/staff/`.
**Erreurs** : `400 invalid_google_token`, `404 user_not_found`, `403 access_denied`.

---

### `POST /auth/login/google/patient/`  *(public)*

Connexion **patient** (mobile) via Google ID Token. Auto-crée le compte
patient (+ `PatientProfile` + rôle `patient`) à la première connexion —
contrairement à `/auth/login/google/` qui exige un compte staff
préexistant.

**Body**
```json
{ "id_token": "<google-id-token>" }
```

**Réponse 200**
```json
{
  "access": "eyJ0eXAi...",
  "refresh": "eyJ0eXAi...",
  "user": { "uuid": "...", "email": "...", "roles": ["patient"] },
  "created": true
}
```

**Erreurs** : `400 invalid_google_token`, `400 no_email`.

---

### `POST /auth/login/firebase/`  *(public)*

Connexion **patient** via Firebase Auth (mobile). Le client envoie
l'ID-token de `firebase.auth().currentUser.getIdToken()`. Le backend
vérifie la signature avec les clés publiques Google
(`securetoken@system.gserviceaccount.com`) et auto-crée le compte
patient à la première connexion. Cf. `FIREBASE_SETUP.md` pour la
configuration.

**Body**
```json
{ "id_token": "<firebase-id-token>" }
```

**Réponse 200** : identique à `/auth/login/google/patient/`.

**Erreurs** :
- `400 invalid_firebase_token` (signature, audience, issuer, expiration KO)
- `400 no_email` (compte Firebase sans email)
- `503 firebase_not_configured` (`FIREBASE_PROJECT_ID` absent côté serveur)

---

### `POST /auth/refresh/`  *(public)*

Renouvelle un `access` à partir d'un `refresh` valide.

**Body**
```json
{ "refresh": "eyJ0eXAi..." }
```

**Réponse 200**
```json
{ "access": "eyJ0eXAi..." }
```

---

### `POST /auth/logout/`  *(authentifié)*

Blackliste le `refresh` token courant.

**Headers** : `Authorization: Bearer <access>`

**Body**
```json
{ "refresh": "eyJ0eXAi..." }
```

**Réponse** : `204 No Content`.

---

### `GET /auth/me/`  *(authentifié)*

Profil de l'utilisateur courant.

**Headers** : `Authorization: Bearer <access>`

**Réponse 200**
```json
{
  "uuid": "8f6e...",
  "phone": "+213555123456",
  "email": "y.mehenni@labconnect.dz",
  "first_name": "Yacine",
  "last_name": "Mehenni",
  "preferred_language": "fr",
  "is_phone_verified": true,
  "roles": ["biologist", "technician"]
}
```

### `PATCH /auth/me/`  *(authentifié)*

Met à jour `first_name`, `last_name`, `email`, `preferred_language`.

**Body**
```json
{ "first_name": "Yacine", "preferred_language": "ar" }
```

---

### `POST /auth/totp/setup/`  *(staff authentifié)*  *(mocké)*

Génère un secret TOTP + QR. En mode démo, l'endpoint reste exposé mais
la vérification est automatiquement validée par le backend.

**Headers** : `Authorization: Bearer <access>`

**Réponse 200**
```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "otpauth_uri": "otpauth://totp/labConnect:...",
  "qr_code_base64": "iVBORw0KGgoAAAANSUhEUgAA..."
}
```

### `POST /auth/totp/confirm/`  *(staff authentifié)*  *(mocké)*

**Body** : `{ "code": "123456" }`
**Réponse 200** : `{ "configured": true }`

### `POST /auth/totp/verify/`  *(authentifié)*  *(mocké)*

Vérifie un code TOTP au login et renouvelle le JWT avec `totp_verified=true`.
En mode démo, **tous les `access` tokens sont déjà émis avec
`totp_verified=true`** (`accounts/tokens.py`), donc cet appel est facultatif.

**Body** : `{ "code": "123456" }`
**Réponse 200** : `{ "access": "...", "refresh": "..." }`

### `DELETE /auth/totp/device/`  *(authentifié)*

Supprime le device TOTP du user courant. `204` si OK, `404` sinon.

---

## Laboratoires

### `GET /laboratories/`  *(public)*

Liste publique des labos.

**Réponse 200**
```json
[
  {
    "uuid": "8f6e...",
    "name": "Labo Saint-Eugène",
    "slug": "labo-saint-eugene",
    "address": "14, rue Didouche Mourad — 16000 Alger",
    "phone": "+213 21 63 47 12",
    "latitude": 36.7538,
    "longitude": 3.0588,
    "accepts_home_visits": true,
    "accepts_emergencies": false,
    "home_visit_fee_mru": "500.00",
    "emergency_fee_mru": "0.00",
    "logo": "/media/lab_logos/se.png",
    "description": "Laboratoire d'analyses médicales accrédité."
  }
]
```

### `GET /laboratories/{uuid}/`  *(public)*

Détail d'un labo, inclut `opening_hours` et `technician_mode`.

### `GET /laboratories/nearby/`  *(public)*

Labos proches d'une position.

**Query params** : `lat`, `lng` (requis), `radius_km` (défaut 10).

```
GET /laboratories/nearby/?lat=36.75&lng=3.06&radius_km=5
```

**Réponse** : liste comme `GET /laboratories/` ordonnée par distance.

---

### `GET /lab/config`  *(chef de labo + 2FA)*

Configuration du labo de l'utilisateur connecté.

**Headers** : `Authorization: Bearer <access>`

**Réponse 200**
```json
{
  "uuid": "8f6e...",
  "name": "Labo Saint-Eugène",
  "address": "14, rue Didouche Mourad — 16000 Alger",
  "phone": "+213 21 63 47 12",
  "email": "contact@labconnect.dz",
  "logo": "/media/lab_logos/se.png",
  "description": "Bienvenue …",
  "accepts_home_visits": true,
  "accepts_emergencies": false,
  "technician_mode": "separate",
  "home_visit_fee_mru": "500.00",
  "emergency_fee_mru": "0.00",
  "opening_hours": {
    "mon": { "open": "08:00", "close": "18:00", "closed": false },
    "sun": { "closed": true }
  }
}
```

### `PATCH /lab/config`  *(chef de labo + 2FA)*

Met à jour la configuration. Tous les champs sont optionnels.

**Body**
```json
{
  "name": "Labo Saint-Eugène",
  "phone": "+213 21 63 47 12",
  "accepts_home_visits": true,
  "home_visit_fee_mru": 500,
  "opening_hours": {
    "mon": { "open": "08:00", "close": "18:00", "closed": false }
  }
}
```

---

## Personnel

### `POST /lab/employees/invite`  *(chef de labo + 2FA)*

Crée un compte staff ou ajoute des rôles à un user existant.

**Headers** : `Authorization: Bearer <access>`

**Body**
```json
{
  "email": "l.saadi@labconnect.dz",
  "phone": "+213555718012",
  "first_name": "Lina",
  "last_name": "Saadi",
  "roles": ["technician", "nurse"],
  "employee_id": "S-04",
  "license_number": "",
  "password": ""
}
```

`roles` est une **liste de 1..N** parmi `secretary, nurse, technician, biologist`
(le rôle `lab_chief` ne peut pas être attribué via cet endpoint).
Si `password` est vide, un mot de passe aléatoire est généré.

**Réponse 201** — voir `GET /lab/employees/{uuid}/`.
**Erreurs** : `409 already_staff`, `400` (validation).

---

### `GET /lab/employees/`  *(chef de labo + 2FA)*

Liste des membres du labo.

**Réponse 200**
```json
[
  {
    "uuid": "8f6e...",
    "phone": "+213555718012",
    "email": "l.saadi@labconnect.dz",
    "first_name": "Lina",
    "last_name": "Saadi",
    "employee_id": "S-04",
    "license_number": "",
    "is_on_duty": true,
    "is_active": true,
    "roles": ["technician", "nurse"],
    "has_2fa": false
  }
]
```

### `GET /lab/employees/{uuid}/`  *(chef de labo + 2FA)*

Détail d'un membre — même schéma que ci-dessus.

### `PATCH /lab/employees/{uuid}/`  *(chef de labo + 2FA)*

Met à jour un membre. Si `roles` est fourni, **remplace l'ensemble** des rôles
attribuables (`lab_chief` est préservé séparément s'il est présent).

**Body**
```json
{
  "first_name": "Lina",
  "last_name": "Saadi",
  "employee_id": "S-04",
  "is_on_duty": false,
  "roles": ["biologist", "technician"]
}
```

### `DELETE /lab/employees/{uuid}/`  *(chef de labo + 2FA)*

Désactive un membre (soft-delete + retire les groupes assignables).
S'il n'a plus aucun profil staff, le compte est mis `is_active=False`.

**Réponse** : `204`.

---

## Catalogue de tests

### `GET /lab/catalog/`  *(authentifié)*

Catalogue des tests du labo du staff connecté.
Patient : doit passer `?lab=<uuid>` ; ne renvoie que les tests `is_active=true`.

**Réponse 200**
```json
[
  {
    "uuid": "8f6e...",
    "code": "NFS",
    "name": "Numération formule sanguine",
    "description": "",
    "sample_type": "blood",
    "price_mru": "1800.00",
    "turnaround_hours": 2,
    "requires_fasting": false,
    "is_active": true
  }
]
```

### `POST /lab/catalog/`  *(chef de labo + 2FA)*

Crée un test. Le `laboratory` est automatiquement celui du chef connecté.

**Body**
```json
{
  "code": "TSH",
  "name": "Thyréostimuline (TSH)",
  "description": "Dosage de la TSH.",
  "sample_type": "blood",
  "price_mru": 2400,
  "turnaround_hours": 24,
  "requires_fasting": false,
  "is_active": true
}
```

### `PATCH /lab/catalog/{uuid}/`  *(chef de labo + 2FA)*

Met à jour un test (mêmes champs, tous optionnels).

### `DELETE /lab/catalog/{uuid}/`  *(chef de labo + 2FA)*

Soft-delete du test. **Réponse** : `204`.

---

## Échantillons

### `GET /lab/samples/`  *(staff + 2FA)*

Liste des échantillons du labo. Query : `?status=pending|collected|received|rejected`.

**Réponse 200**
```json
[
  {
    "uuid": "8f6e...",
    "barcode": "S3A2F1B0C9",
    "sample_type": "blood",
    "status": "received",
    "appointment_uuid": "5c1d...",
    "patient_phone": "+213555123456",
    "patient_name": "Khaled Bouzid",
    "collected_at": "2026-05-22T07:12:00Z",
    "received_at": "2026-05-22T07:24:00Z",
    "rejection_reason": "",
    "created_at": "2026-05-22T07:00:00Z",
    "updated_at": "2026-05-22T07:24:00Z"
  }
]
```

### `POST /lab/samples/`  *(secrétaire / infirmier / chef + 2FA)*

Crée un échantillon à partir d'un RDV.

**Body**
```json
{
  "appointment_uuid": "5c1d...",
  "test_uuids": ["8f6e...", "9a01..."],
  "sample_type": "blood"
}
```

### `PATCH /lab/samples/{uuid}/receive/`  *(technicien / biologiste / chef + 2FA)*

Marque l'échantillon comme reçu. Met les `TestOrder` PENDING en `IN_PROGRESS`.

**Body** : aucun.

### `PATCH /lab/samples/{uuid}/reject/`  *(technicien / biologiste / chef + 2FA)*

Rejette l'échantillon. Tous les ordres associés passent en `REJECTED`.

**Body**
```json
{ "reason": "Hémolysé" }
```

### `POST /lab/walk-in/`  *(secrétaire / infirmier·e / chef + 2FA)*

Crée une analyse pour un patient qui se présente au comptoir **sans
l'app mobile**. La requête est atomique : find-or-create du patient par
téléphone (+ hydrate les champs `first_name` / `last_name` / `email`
s'ils sont fournis et vides en DB) ; création d'un `Appointment`
`visit_type=in_lab` `status=confirmed` `scheduled_for=now` ; création
d'un `Sample` avec barcode auto + un `TestOrder` par test.

**Headers** : `Authorization: Bearer <access>` + `X-Lab-Uuid: <lab-uuid>`.

**Body**
```json
{
  "phone": "+222 22 12 34 56",
  "first_name": "Aminetou",            // facultatif (nouveau patient)
  "last_name": "Mint Mohamed",         // facultatif
  "email": "aminetou@exemple.mr",      // facultatif
  "cnam_number": "MR-2026-12345",      // facultatif — persisté sur le profil
  "cnam_coverage_pct": 80,             // facultatif — 0–100, persisté sur le profil
  "test_uuids": ["8f6e...", "9a01..."],
  "sample_type": "blood",              // facultatif — sinon type du 1er test
  "notes": "Bilan de routine",         // facultatif
  // Réponses au questionnaire pré-test, indexées par test_uuid.
  // Chaque entrée est une liste de chaînes alignée avec les
  // `prerequisite_questions` du test (chaînes vides si non répondu).
  "prerequisite_answers": {
    "8f6e...": ["Oui", "18h hier", "Aucune"]
  }
}
```

Le `cnam_coverage_pct` est appliqué à chaque `TestOrder` créé : le split
est figé à la création (covered/due en MRU entiers), pour qu'une variation
ultérieure du taux n'affecte pas les factures historiques. Si les champs
CNAM sont omis et que le patient existe déjà avec une couverture en base,
celle-ci est réutilisée.

**Réponse 201**
```json
{
  "appointment_uuid": "5c1d...",
  "patient_uuid": "a31f...",
  "patient_phone": "+22222123456",
  "patient_created": true,
  "sample": { "uuid": "...", "barcode": "S3A2F1B0C9", "sample_type": "blood", ... },
  "tests_count": 2,
  "total_mru": 2400,
  "cnam_coverage_pct": 80,
  "cnam_covered_total_mru": 1920,
  "patient_due_total_mru": 480
}
```

**Erreurs**
- `400 {"phone": [...]}` — téléphone invalide
- `400 {"test_uuids": "Un ou plusieurs tests sont invalides pour ce labo."}`
- `400 {"lab": "Aucun laboratoire actif (header X-Lab-Uuid)."}`
- `403` — rôle hors `{secretary, nurse, technician, lab_chief}`

---

### `GET /lab/invoices/{appointment_uuid}/`  *(staff + 2FA)*

Renvoie la facture détaillée d'un rendez-vous : items par test (prix, part
CNAM, dû patient, statut), totaux, fees éventuels du RDV (visite domicile,
urgence), patient + labo.

**Headers** : `Authorization: Bearer <access>` + `X-Lab-Uuid: <lab-uuid>`.

**Réponse 200**
```json
{
  "appointment_uuid": "5c1d...",
  "scheduled_for": "2026-05-30T08:24:00Z",
  "visit_type": "in_lab",
  "patient": {
    "uuid": "a31f...",
    "phone": "+22222123456",
    "name": "Aminetou Mint Mohamed",
    "cnam_number": "MR-2026-12345",
    "cnam_coverage_pct": 80
  },
  "laboratory": { "uuid": "...", "name": "Labo Centre Nouakchott" },
  "items": [
    {
      "order_uuid": "...",
      "test_code": "NFS",
      "test_name": "Numération formule sanguine",
      "sample_barcode": "S3A2F1B0C9",
      "price_mru": 1800,
      "cnam_covered_mru": 1440,
      "patient_due_mru": 360,
      "status": "validated"
    }
  ],
  "appointment_fees_mru": 0,
  "subtotal_mru": 1800,
  "cnam_covered_total_mru": 1440,
  "patient_due_total_mru": 360,
  "issued_at": "2026-05-30T10:00:00Z"
}
```

**Erreurs**
- `400 {"appointment_uuid": "RDV introuvable."}` — uuid invalide ou autre labo
- `400 {"lab": "Aucun laboratoire actif (header X-Lab-Uuid)."}`

---

### `GET /lab/stats/?days=7`  *(staff + 2FA)*

Tableau de bord agrégé pour le labo courant sur une fenêtre glissante
(défaut 7, clampé à 1–90 jours). Les agrégats financiers (`revenue_mru`,
`cnam_share_mru`, `patient_share_mru` et `revenue_mru` par catégorie)
sont nuls (`null`) pour qui n'a pas la permission `viewFinance` (rôles
biologiste ou chef de labo).

**Réponse 200**
```json
{
  "period_days": 7,
  "since": "2026-05-23T08:00:00Z",
  "kpis": {
    "total_orders": 142,
    "completed_orders": 16,
    "validated_orders": 96,
    "rejected_orders": 4,
    "revenue_mru": 196000,
    "cnam_share_mru": 145000,
    "patient_share_mru": 51000,
    "avg_tat_hours": 2.4,
    "all_time_total": 3120
  },
  "by_status": [
    { "status": "validated", "count": 96 },
    { "status": "completed", "count": 16 }
  ],
  "by_category": [
    { "category": "blood", "count": 92, "revenue_mru": 132000 }
  ],
  "by_day": [
    { "date": "2026-05-25", "orders": 18, "validated": 12 }
  ],
  "by_technician": [
    { "uuid": "...", "name": "Sidi Ould", "results_entered": 24 }
  ],
  "low_stock_items": [
    { "uuid": "...", "name": "Tubes EDTA", "current_stock": 12, "min_stock": 20, "unit": "tube" }
  ]
}
```

---

## Inventaire

Suivi des réactifs / consommables / équipements. Chaque article est
rattaché à un labo. Les variations de stock passent toujours par un
mouvement (`POST .../movement/`) pour rester auditables (qui, quand,
combien, pourquoi).

### `GET /lab/inventory/`  *(staff + 2FA)*

Liste des articles. Query params optionnels :
- `?category=reagent|consumable|equipment|other`
- `?low_stock=1` — filtre uniquement les articles sous leur seuil

**Réponse 200** : liste d'`InventoryItem` avec `current_stock`,
`min_stock`, `unit_cost_mru`, `is_low_stock`.

### `POST /lab/inventory/`  *(chef / technicien / biologiste + 2FA)*

Crée un article. Si `initial_stock > 0`, un mouvement `delivery` est
créé automatiquement dans la même transaction (note : "Stock initial").

**Body**
```json
{
  "name": "Tubes EDTA 4mL",
  "code": "EDTA-4ML",
  "category": "consumable",
  "unit": "tube",
  "min_stock": 200,
  "unit_cost_mru": 12,
  "supplier": "LaboFournitures",
  "notes": "",
  "initial_stock": 1000
}
```

### `PATCH /lab/inventory/{uuid}/`  *(chef / technicien / biologiste + 2FA)*

Met à jour les caractéristiques (nom, seuil, coût, etc.). Le
`current_stock` ne se modifie pas par PATCH — passer par un mouvement.

### `DELETE /lab/inventory/{uuid}/`  *(chef + 2FA)*

Soft delete de l'article. Historique des mouvements conservé.

### `POST /lab/inventory/{uuid}/movement/`  *(chef / technicien / biologiste + 2FA)*

Enregistre un mouvement de stock et met à jour le stock atomiquement
(SELECT FOR UPDATE — pas de race). Refuse si le stock résultant serait
négatif (sauf `adjustment` / `expiry` explicitement signés).

**Body**
```json
{
  "delta": 50,                   // signé : > 0 entrée, < 0 sortie
  "reason": "delivery",          // delivery | consumption | adjustment | expiry
  "notes": "BL #1234"            // facultatif
}
```

**Réponse 201**
```json
{
  "movement": { "uuid": "...", "delta": "50.00", "reason": "delivery", "notes": "BL #1234", "by_name": "Sidi", "created_at": "..." },
  "item": { "uuid": "...", "current_stock": "1050.00", "is_low_stock": false, ... }
}
```

**Erreurs**
- `400 {"delta": "Une livraison doit être positive."}`
- `400 {"delta": "Une consommation doit être négative."}`
- `400 {"delta": "Stock insuffisant : 12 tube disponibles, impossible de retirer 50."}`

### `GET /lab/inventory/{uuid}/movements/`  *(staff + 2FA)*

Liste des 200 derniers mouvements pour cet article.

---

## Ordres & résultats

### `GET /lab/orders/`  *(staff + 2FA)*

Liste des ordres pour le labo. Query : `?status=in_progress|completed|validated|…`.
Un technicien (sans biologiste) ne voit que les ordres qui lui sont assignés
ou non assignés.

**Réponse 200**
```json
[
  {
    "uuid": "ab12...",
    "status": "in_progress",
    "test_code": "TSH",
    "test_name": "Thyréostimuline (TSH)",
    "price_mru": "2400.00",
    "sample_barcode": "S3A2F1B0C9",
    "patient_name": "Khaled Bouzid",
    "started_at": "2026-05-22T07:24:00Z",
    "completed_at": null,
    "has_result": false,
    "created_at": "2026-05-22T07:00:00Z"
  }
]
```

### `GET /lab/orders/{uuid}/result/`  *(staff + 2FA)*

Récupère le résultat saisi (ou `404` s'il n'existe pas).

### `POST /lab/orders/{uuid}/result/`  *(technicien / biologiste / chef + 2FA)*

Saisie du résultat. Passe l'ordre en `completed`.

**Body**
```json
{
  "value": "2.3",
  "unit": "mUI/L",
  "reference_range": "0.4 – 4.0",
  "flag": "normal",
  "technician_notes": "Prélèvement à jeun."
}
```
`flag` ∈ `normal | low | high | critical`.

### `PATCH /lab/orders/{uuid}/result/`  *(biologiste / chef + 2FA)*

Validation du résultat par un biologiste. Passe l'ordre en `validated`.
Le biologiste peut **corriger** la valeur saisie par le technicien (cas
typique : relecture critique, recalibrage). La valeur d'origine est alors
archivée dans `TestResult.original_value` pour la traçabilité.

**Body**
```json
{
  "biologist_comment": "Conforme. Aucune action particulière.",
  "value": "2.4",          // facultatif — si différent, archive la version technicien
  "unit": "mUI/L",         // facultatif
  "reference_range": "0.4 – 4.0",  // facultatif
  "flag": "normal"         // facultatif : normal | low | high | critical
}
```

**Réponse 200** : objet `TestResult` mis à jour, avec `original_value`
non vide si le biologiste a corrigé.

---

### `GET /results/mine/`  *(authentifié)*

Résultats validés du patient connecté.

**Réponse** : liste de `TestResult` avec `value`, `unit`, `flag`,
`biologist_validated_at`, `biologist_comment`, `test_name`, `test_code`.

---

## Rendez-vous

### `GET /appointments/`  *(patient OU staff + 2FA)*

Liste des RDV. Patient → ses propres RDV. Staff → RDV du labo.
Query params : `status`, `visit_type`, `date` (YYYY-MM-DD).

**Réponse 200**
```json
[
  {
    "uuid": "5c1d...",
    "laboratory_uuid": "8f6e...",
    "laboratory_name": "Labo Saint-Eugène",
    "patient_uuid": "ab12...",
    "patient_phone": "+213555123456",
    "patient_name": "Khaled Bouzid",
    "visit_type": "in_lab",
    "status": "confirmed",
    "scheduled_for": "2026-05-22T09:30:00Z",
    "duration_minutes": 30,
    "home_address": "",
    "nurse_uuid": null,
    "nurse_name": null,
    "base_fee_mru": "0.00",
    "surcharge_mru": "0.00",
    "total_fee_mru": "0.00",
    "notes": "",
    "created_at": "2026-05-20T11:14:00Z",
    "updated_at": "2026-05-20T11:14:00Z"
  }
]
```

### `POST /appointments/`  *(patient OU secrétaire/chef + 2FA)*

Crée un RDV. Patient → pour lui-même. Staff → pour un patient (par téléphone).

**Body (staff)**
```json
{
  "laboratory_uuid": "8f6e...",
  "patient_phone": "+213555123456",
  "visit_type": "in_lab",
  "scheduled_for": "2026-05-22T09:30:00Z",
  "duration_minutes": 30,
  "home_address": "",
  "notes": ""
}
```
`visit_type` ∈ `in_lab | home | emergency`. Pour `home` / `emergency`, le labo
doit avoir activé l'option correspondante — sinon `400`.

### `GET /appointments/mine/`  *(patient)*

Raccourci : RDV du patient connecté.

### `GET /appointments/home-visits/`  *(infirmier + 2FA)*

Visites à domicile assignées à l'infirmier connecté, statut `confirmed` ou
`in_progress`.

### `PATCH /appointments/{uuid}/cancel/`  *(patient ou staff)*

Annule un RDV. Un patient ne peut annuler que ses propres RDV en `pending` ou
`confirmed`.

**Body** : aucun.

### `PATCH /appointments/{uuid}/status/`  *(staff + 2FA)*

Change le statut, et optionnellement assigne un infirmier.

**Body**
```json
{ "status": "confirmed", "nurse_uuid": "ab12..." }
```
`status` ∈ `pending | confirmed | checked_in | in_progress | completed | cancelled | no_show`.

---

## Schéma OpenAPI

Une documentation interactive est exposée :

- `GET /api/schema/` — JSON OpenAPI 3.
- `GET /api/docs/`   — Swagger UI.
- `GET /api/redoc/`  — ReDoc.

## Comptes de démonstration

Après `python manage.py seed_demo` :

| Login                                     | Mot de passe   | Rôle           |
| ----------------------------------------- | -------------- | -------------- |
| `chef.labo@labconnect.dz` (ou `chef.labo`)| `admin1234`    | `lab_chief`    |
| `patient.demo`                            | `patient1234`  | `patient`      |

> 2FA mockée : aucun code TOTP à saisir réellement, n'importe quelle valeur
> à 6 chiffres est acceptée côté frontend.
