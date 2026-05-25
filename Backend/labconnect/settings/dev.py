"""Dev settings — local Docker Compose stack."""
from .base import *  # noqa: F401,F403

# noqa-safe: we want everything imported
from .base import INSTALLED_APPS, MIDDLEWARE, SIMPLE_JWT, SECRET_KEY  # re-export typed names for linters

DEBUG = True
ALLOWED_HOSTS = ["*"]

# ── CORS — config explicite pour le dev local ─────────────────────────────
# On évite CORS_ALLOW_ALL_ORIGINS = True car il interagit mal avec
# CORS_ALLOW_CREDENTIALS = True (le navigateur refuse "Allow-Origin: *"
# quand les credentials sont autorisés).
#
# Les regex couvrent toutes les IP du LAN privé (192.168.x.x, 10.x.x.x,
# 172.16-31.x.x) + localhost sur n'importe quel port, pour que les apps web
# en dev et l'app mobile via Expo Go puissent appeler le backend.
# Les requêtes natives n'ont souvent pas de header `Origin` (CORS ne
# s'applique pas), mais Expo Go web et certains fetch en envoient un.
CORS_ALLOWED_ORIGIN_REGEXES = [
    r"^http://192\.168\.\d+\.\d+(:\d+)?$",
    r"^http://10\.\d+\.\d+\.\d+(:\d+)?$",
    r"^http://172\.(1[6-9]|2[0-9]|3[01])\.\d+\.\d+(:\d+)?$",
    r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
]
CORS_ALLOW_CREDENTIALS = True
# En-têtes custom que notre frontend envoie
CORS_ALLOW_HEADERS = [
    "accept",
    "accept-encoding",
    "authorization",
    "content-type",
    "dnt",
    "origin",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
    "x-lab-uuid",  # ← header maison pour le scoping multi-labo
]
CORS_ALLOW_METHODS = ["DELETE", "GET", "OPTIONS", "PATCH", "POST", "PUT"]
# Expose le header au frontend (utile pour debug)
CORS_EXPOSE_HEADERS = ["content-type", "x-lab-uuid"]

# ── django-axes : ignore les preflight OPTIONS pour éviter les faux blocages ─
# (sinon Axes peut compter une tentative à chaque preflight et bloquer
#  l'IP avant même le POST réel.)
AXES_NEVER_LOCKOUT_GET = True
AXES_NEVER_LOCKOUT_WHITELIST = True
AXES_IPWARE_PROXY_COUNT = 0

# Friendlier email backend for dev
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

# Dev: allow HTTP cookies
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False

# Dev fallback: .env laisse les clés RSA vides, donc on signe les JWT en HS256.
SIMPLE_JWT.update(
    {
        "ALGORITHM": "HS256",
        "SIGNING_KEY": SECRET_KEY,
        "VERIFYING_KEY": "",
    }
)

# Django Debug Toolbar could be added here later if needed
