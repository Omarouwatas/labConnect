# Firebase Auth — guide d'intégration

LabConnect utilise Firebase **uniquement comme provider d'identité** pour
l'app mobile patient (en plus du SMS + login email backend existants).
La vraie session de l'utilisateur reste le JWT LabConnect émis par le
backend Django.

```
[App mobile] ──Firebase sign-in──▶ [Firebase Auth]
     │                                    │
     │   ◀──── ID-token Firebase ─────────┘
     │
     ├── POST /auth/login/firebase/ { id_token } ──▶ [Backend Django]
     │                                                      │
     │   ◀──── { access, refresh, user } (JWT LabConnect) ──┘
```

Le backend vérifie la JWT Firebase via les **clés publiques Google**
(aucun fichier service-account, aucune dépendance Python supplémentaire :
on utilise PyJWT déjà présent).

## 1. Créer un projet Firebase

1. Va sur https://console.firebase.google.com/ → **Add project**.
2. Donne-lui un nom (ex. `labconnect-mr`). Désactive Google Analytics (pas utile pour la démo).

## 2. Activer les providers Email + Google

Dans la console Firebase :

- **Authentication** → **Get started** (si pas déjà fait).
- Onglet **Sign-in method**.
- Active **Email/Password** → **Save**.
- Active **Google** → choisis un email de support → **Save**.

## 3. Ajouter une **Web App** (pour récupérer la config)

- ⚙️ **Project settings** → **Your apps** → icône **`</>`** (Web).
- Nickname : `labconnect-mobile`. **Register app**.
- Copie l'objet `firebaseConfig` (apiKey, authDomain, projectId, etc.).

## 4. Configurer le frontend mobile

Deux options :

### A. Direct dans `frontend-client/src/firebase.js`

Remplace les `REPLACE_ME` par ta config :

```js
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSy...",
  authDomain:        "labconnect-mr.firebaseapp.com",
  projectId:         "labconnect-mr",
  storageBucket:     "labconnect-mr.appspot.com",
  messagingSenderId: "123456789012",
  appId:             "1:123456789012:web:abc123",
};
```

### B. Via `app.json` (recommandé — pas de secret committé)

```json
{
  "expo": {
    "extra": {
      "firebase": {
        "apiKey":            "AIzaSy...",
        "authDomain":        "labconnect-mr.firebaseapp.com",
        "projectId":         "labconnect-mr",
        "storageBucket":     "labconnect-mr.appspot.com",
        "messagingSenderId": "123456789012",
        "appId":             "1:123456789012:web:abc123"
      }
    }
  }
}
```

> La clé `apiKey` Firebase **n'est pas un secret** au sens classique —
> elle identifie le projet, pas un compte de service. Il faut quand
> même la garder hors du repo public si possible.

## 5. Configurer le backend

Dans `Backend/.env` :

```bash
FIREBASE_PROJECT_ID=labconnect-mr
```

Redémarre Django. Sans cette variable, `POST /auth/login/firebase/`
répond `503 firebase_not_configured`.

## 6. Installer la dépendance + redémarrer Expo

```bash
cd frontend-client
npm install         # installe firebase
npx expo start --clear
```

Scanne le QR avec Expo Go. Ouvre l'onglet **🔥 Firebase** sur l'écran
de login.

## 7. Tester

### Email + mot de passe

1. Onglet **🔥 Firebase** → sous-onglet **Créer un compte**.
2. Email + mot de passe (≥ 6 caractères) → **Créer mon compte**.
3. Tu devrais arriver sur l'écran Home en tant que patient
   (auto-créé côté backend).
4. Vérifie dans la console Firebase → **Authentication** → **Users**
   que l'utilisateur apparaît.

### Google via Firebase

1. Onglet **🔥 Firebase** → bouton **Continuer avec Google (Firebase)**.
2. Le proxy Expo ouvre le flux Google → tu choisis ton compte.
3. Le Google ID-token est converti en credential Firebase, puis envoyé
   au backend.
4. Premier login → compte patient auto-créé.

> ⚠️ Pour que le bouton **Google (Firebase)** fonctionne, il faut aussi
> avoir tes **Google Client IDs** dans `app.json → extra.googleClientIds`
> (les mêmes que ceux utilisés par le bouton "Continuer avec Google" du
> haut de l'écran de login).

## Architecture détaillée

| Couche                          | Responsabilité                                  |
| ------------------------------- | ----------------------------------------------- |
| `src/firebase.js` (mobile)      | Init Firebase, helpers `firebaseSignInEmail`/`firebaseSignUpEmail`/`firebaseSignInWithGoogle` |
| `src/api.js::firebaseLogin`     | POST l'ID-token Firebase au backend             |
| `src/auth.js::loginWithFirebase`| Stocke le JWT LabConnect dans AsyncStorage      |
| `accounts/services/firebase.py` | Vérifie la signature JWT avec les clés Google   |
| `accounts/views.FirebaseLoginView` | Find-or-create patient, émet JWT LabConnect  |

## Dépannage

- **`firebase_not_configured` (503)** → `FIREBASE_PROJECT_ID` manquant
  dans `Backend/.env`.
- **`invalid_firebase_token` (400)** → le token a expiré (>1 h) ou le
  `projectId` mobile ≠ `FIREBASE_PROJECT_ID` backend.
- **Crash "Component auth has not been registered yet"** → tu utilises
  `firebase` v9 ; passe à `firebase@^12.0.0` (déjà dans `package.json`).
- **Bouton Google Firebase ne fait rien** → renseigne
  `app.json → extra.googleClientIds`.
- **"You are initializing Firebase Auth for React Native without
  providing AsyncStorage"** → bénin, peut être ignoré ; on ne persiste
  pas la session Firebase exprès (la persistance se fait via le JWT
  LabConnect dans AsyncStorage côté `src/api.js`).
