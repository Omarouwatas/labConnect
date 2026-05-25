# SmartLAB Backend

API Django REST pour la gestion des laboratoires, reservations, prelevements,
paiements B-Pay, resultats et notifications.

## Environnement Python

Le backend utilise un vrai virtualenv local:

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Sans activation:

```powershell
.\.venv\Scripts\python.exe manage.py check
```

## Base PostgreSQL

La configuration Django lit ces variables:

```text
POSTGRES_DB=smartlab_db
POSTGRES_USER=smartlab_user
POSTGRES_PASSWORD=smartlab_password
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
GDAL_LIBRARY_PATH=
GEOS_LIBRARY_PATH=
```

Elles sont documentees dans `.env.example`.

### Option Docker

```powershell
docker compose up -d postgres
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py seed_demo
```

Le service Docker utilise `postgis/postgis:16-3.5`, donc l'extension PostGIS est
disponible cote base de donnees.

### Option PostgreSQL local

Creer une base et un utilisateur correspondant aux variables ci-dessus, ou
modifier les variables d'environnement pour utiliser vos identifiants existants.

## GDAL / GEOS pour GeoDjango

GeoDjango a besoin de bibliotheques natives GDAL et GEOS sur la machine qui
execute Django. Ce ne sont pas de simples dependances Python du venv.

Sur Windows, installer OSGeo4W, puis definir les chemins DLL avant de lancer
Django. Exemple courant:

```powershell
$env:GDAL_LIBRARY_PATH="C:\OSGeo4W\bin\gdal310.dll"
$env:GEOS_LIBRARY_PATH="C:\OSGeo4W\bin\geos_c.dll"
$env:PATH="C:\OSGeo4W\bin;$env:PATH"
```

Les noms exacts peuvent varier selon la version installee (`gdal309.dll`,
`gdal310.dll`, etc.). Verifier le contenu de `C:\OSGeo4W\bin`.

Apres installation:

```powershell
.\.venv\Scripts\python.exe manage.py check
.\.venv\Scripts\python.exe manage.py migrate
```

## Lancer le backend

```powershell
.\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000
```

## Comptes demo

- Admin labo: `chef.labo` / `admin1234`
- Patient: `patient.demo` / `patient1234`

Regenerer les donnees demo:

```powershell
.\.venv\Scripts\python.exe manage.py seed_demo
```

## Authentification JWT

```http
POST /api/auth/token/
POST /api/auth/token/refresh/
```

Payload:

```json
{
  "username": "chef.labo",
  "password": "admin1234"
}
```

Utiliser ensuite:

```http
Authorization: Bearer <access_token>
```

## Routes principales

- `GET /api/laboratories/`
- `GET /api/tests/?laboratory=<id>`
- `GET /api/bookings/`
- `GET /api/home-samplings/`
- `GET /api/payments/`
- `POST /api/payments/<id>/verify/`
- `GET /api/results/`
- `POST /api/results/<id>/publish/`
- `GET /api/notifications/`
- `GET /api/dashboard/summary/`

## Notes techniques

- PostgreSQL est la base cible du projet.
- GeoDjango/PostGIS est active avec des champs `PointField` sur les laboratoires
  et les prelevements a domicile.
- Les fichiers de resultats utilisent `FileField`; en production, brancher MinIO/S3.
- Le suivi live du preleveur sera ajoute avec Django Channels/WebSocket.
