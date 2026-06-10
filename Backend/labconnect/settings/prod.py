"""Production settings — free-tier friendly.

Cible : Render.com (Web Service free) + Supabase Postgres (free, avec
PostGIS) + WhiteNoise pour le static + médias sur le disque éphémère
de Render. Aucun Redis, aucun MinIO, aucun Sentry obligatoire.

Différences clés vs `base.py` :
  - Lit `DATABASE_URL` (standard 12-factor : Render, Supabase, Railway,
    Heroku le supportent tous) au lieu des variables POSTGRES_* séparées.
  - Désactive `channels` (WebSockets) : tient à Redis.
  - Force Celery en mode synchrone (`ALWAYS_EAGER`) : les `.delay()`
    s'exécutent inline, donc rien à faire tourner en plus du gunicorn.
  - WhiteNoise sert les fichiers statiques compressés directement
    depuis le process Django — aucun CDN, aucun bucket à configurer.
  - JWT bascule en HS256 si les clés RS256 ne sont pas fournies (un
    seul `DJANGO_SECRET_KEY` suffit pour démarrer).
  - Sentry opt-in : ne s'initialise que si `SENTRY_DSN` est défini.
  - Sécurité : HSTS, SSL redirect, cookies secure — Render expose la
    bonne en-tête `X-Forwarded-Proto`, on lit dessus.

Variables d'env à définir sur Render (Service → Environment) :
  Obligatoires
    DJANGO_SECRET_KEY        → generateValue: true (Render le fait)
    DATABASE_URL             → la URI de connexion Supabase
    DJANGO_ALLOWED_HOSTS     → "labconnect-api.onrender.com" (votre URL)
    CORS_ALLOWED_ORIGINS     → "https://labconnect.vercel.app" (votre web)

  Optionnelles
    SENTRY_DSN               → si vous voulez du tracking d'erreurs
    OTP_PROVIDER             → "mock" pour la démo, "twilio" en vrai
    JWT_PRIVATE_KEY_BASE64   → si vous voulez RS256 (sinon HS256 auto)
    JWT_PUBLIC_KEY_BASE64    → idem
"""
from __future__ import annotations

import logging

from .base import *  # noqa: F401,F403
from .base import (
    BASE_DIR, INSTALLED_APPS, MIDDLEWARE, SECRET_KEY, SIMPLE_JWT, env,
)

DEBUG = False

# ── Database ─────────────────────────────────────────────────────────
# `DATABASE_URL` = format standard postgres://user:pass@host:port/db?sslmode=…
# Supabase et Render exposent les deux cette variable telle quelle.
# `env.db_url()` (django-environ) la parse en dict Django prêt à l'emploi.
DATABASES = {"default": env.db_url("DATABASE_URL")}
# On force le backend PostGIS — Supabase active l'extension via une commande
# SQL unique (`CREATE EXTENSION IF NOT EXISTS postgis;`). Si vous avez retiré
# PostGIS du projet (variant lat/lng FloatField), remplacez la ligne par :
#   DATABASES["default"]["ENGINE"] = "django.db.backends.postgresql"
DATABASES["default"]["ENGINE"] = "django.contrib.gis.db.backends.postgis"
DATABASES["default"].setdefault("CONN_MAX_AGE", 60)
# Supabase exige SSL — on l'ajoute même si la URL ne le porte pas.
DATABASES["default"].setdefault("OPTIONS", {})
DATABASES["default"]["OPTIONS"].setdefault("sslmode", "require")

# ── Allowed hosts ────────────────────────────────────────────────────
# Render auto-attribue un sous-domaine en `.onrender.com`. On l'autorise
# en plus de la liste explicite de la variable d'env, pour que le
# health-check interne de Render passe sans config supplémentaire.
ALLOWED_HOSTS = list(env.list("DJANGO_ALLOWED_HOSTS", default=[])) + [".onrender.com"]

# ── Channels (WebSocket) : désactivé, pas de Redis ───────────────────
# La cloche notifications mobile/web fait du polling (toutes les 30 s)
# donc on n'a pas besoin de WebSockets pour le démo. On ne retire pas
# l'app brutalement de THIRD_PARTY_APPS — on la filtre ici pour ne pas
# casser le startup quand `channels_redis` n'a pas de broker à pointer.
INSTALLED_APPS = [a for a in INSTALLED_APPS if a != "channels"]
ASGI_APPLICATION = None  # gunicorn WSGI uniquement
# Au cas où du code lirait CHANNEL_LAYERS : on remplace par un layer
# in-memory, fonctionnel mais non partagé entre processes.
CHANNEL_LAYERS = {
    "default": {"BACKEND": "channels.layers.InMemoryChannelLayer"},
}

# ── Celery : tâches en mode synchrone ────────────────────────────────
# Sans broker Redis, on ne peut pas lancer un worker. Le mode EAGER
# fait que tout appel `.delay()` / `.apply_async()` exécute la fonction
# IMMÉDIATEMENT dans le request handler. Pour un démo c'est OK ; en
# vrai prod il faudra un worker (Render Background Worker = $7/mois,
# ou Upstash Redis free tier + worker Render).
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
# On retire le broker pour ne pas tenter une connexion au démarrage.
CELERY_BROKER_URL = "memory://"
CELERY_RESULT_BACKEND = "cache+memory://"

# ── Static files (WhiteNoise) ────────────────────────────────────────
# WhiteNoise sert les fichiers compressés directement depuis le process
# Python — pas besoin de S3/CDN. Le middleware doit être JUSTE après
# SecurityMiddleware, sinon les headers de sécurité ne s'appliquent
# pas aux assets servis.
if "whitenoise.middleware.WhiteNoiseMiddleware" not in MIDDLEWARE:
    sec_idx = MIDDLEWARE.index("django.middleware.security.SecurityMiddleware")
    MIDDLEWARE.insert(sec_idx + 1, "whitenoise.middleware.WhiteNoiseMiddleware")

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        # Compresse + hash les noms de fichiers pour cache-busting agressif.
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

# Médias : sur Render free, le disque est ÉPHÉMÈRE. Tout fichier uploadé
# (logo labo, scan d'ordonnance…) disparaît au prochain redéploiement.
# Pour la démo c'est tolérable. Pour persister gratuitement, plug :
#   - Cloudinary (free tier) via django-cloudinary-storage
#   - Bunny.net Storage (~1 €/mois)
#   - Render disque persistant ($1/mois pour 1 Go)
MEDIA_ROOT = BASE_DIR / "media"

# ── JWT — fallback HS256 si pas de clés RS256 ────────────────────────
# Génération de clés RS256 (RFC 3447) un peu lourde pour démarrer :
#   openssl genrsa -out private.pem 2048
#   openssl rsa -in private.pem -pubout -out public.pem
#   base64 -w0 private.pem  # → JWT_PRIVATE_KEY_BASE64
#   base64 -w0 public.pem   # → JWT_PUBLIC_KEY_BASE64
# En HS256 on n'a qu'à protéger SECRET_KEY (déjà obligatoire).
if not SIMPLE_JWT.get("SIGNING_KEY"):
    SIMPLE_JWT = {
        **SIMPLE_JWT,
        "ALGORITHM": "HS256",
        "SIGNING_KEY": SECRET_KEY,
        "VERIFYING_KEY": "",
    }

# ── CORS ─────────────────────────────────────────────────────────────
# Liste exacte d'origines depuis env. Si vous voulez tout autoriser
# (déconseillé hors démo) → CORS_ALLOW_ALL_ORIGINS = True.
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[])
CORS_ALLOW_CREDENTIALS = False

# Django 4+ exige `CSRF_TRUSTED_ORIGINS` pour les POSTs cross-host
# (notamment l'admin Django depuis un domaine custom).
CSRF_TRUSTED_ORIGINS = (
    list(env.list("CSRF_TRUSTED_ORIGINS", default=[]))
    + [f"https://{h.lstrip('.')}" for h in ALLOWED_HOSTS if h not in ("*",)]
)

# ── Sécurité HTTPS ───────────────────────────────────────────────────
# Render termine TLS au load-balancer ; il propage le scheme via
# X-Forwarded-Proto. Sans cet hint, Django croit que toute requête est
# en http et refuse les cookies "secure".
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = True
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 365   # 1 an
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_BROWSER_XSS_FILTER = True
X_FRAME_OPTIONS = "DENY"

SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SECURE = True

# ── Sentry — opt-in ──────────────────────────────────────────────────
# On importe Sentry seulement si le DSN est fourni. Comme ça, retirer
# `sentry-sdk` du requirements.txt ne casse pas le déploiement.
SENTRY_DSN = env("SENTRY_DSN", default="")
if SENTRY_DSN:
    try:
        import sentry_sdk
        from sentry_sdk.integrations.django import DjangoIntegration

        sentry_sdk.init(
            dsn=SENTRY_DSN,
            integrations=[DjangoIntegration()],
            traces_sample_rate=0.05,   # léger en free tier
            send_default_pii=False,
            environment="production",
        )
    except ImportError:
        logging.getLogger(__name__).warning(
            "SENTRY_DSN défini mais sentry-sdk absent — ignoré.",
        )

# ── OTP / Twilio ─────────────────────────────────────────────────────
# Pour la démo gratuite on reste sur OTP mock : tout code à 6 chiffres
# est accepté côté backend. Voir `accounts/views.py` OTPVerifyView.
# En vrai, mettre OTP_PROVIDER=twilio + les clés.
OTP_PROVIDER = env("OTP_PROVIDER", default="mock")

# ── Logging — un peu plus verbeux pour pister les déploiements ───────
LOGGING["root"]["level"] = env("DJANGO_LOG_LEVEL", default="INFO")
