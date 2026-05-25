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

**Body**
```json
{ "biologist_comment": "Conforme. Aucune action particulière." }
```

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
