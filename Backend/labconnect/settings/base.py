"""
Base settings for LabConnect.

Shared across all environments. Environment-specific overrides live in
`dev.py` and `prod.py`. All secrets & env-dependent values are read from
environment variables via django-environ (12-factor).
"""
from __future__ import annotations

import base64
from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
    DJANGO_ALLOWED_HOSTS=(list, []),
    CORS_ALLOWED_ORIGINS=(list, []),
)
# Auto-load .env in dev/local (no-op if missing)
environ.Env.read_env(BASE_DIR / ".env")

# ── GeoDjango (GDAL/GEOS — requis sur Windows, auto-détecté sur Linux/Mac) ──
_gdal_path = env("GDAL_LIBRARY_PATH", default="")
_geos_path = env("GEOS_LIBRARY_PATH", default="")
if _gdal_path:
    GDAL_LIBRARY_PATH = _gdal_path
if _geos_path:
    GEOS_LIBRARY_PATH = _geos_path

# ── Core ──────────────────────────────────────────────────────────────────
SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env("DJANGO_DEBUG")
ALLOWED_HOSTS = env("DJANGO_ALLOWED_HOSTS")

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
ROOT_URLCONF = "labconnect.urls"
WSGI_APPLICATION = "labconnect.wsgi.application"
ASGI_APPLICATION = "labconnect.asgi.application"

AUTH_USER_MODEL = "accounts.User"

# ── Apps ──────────────────────────────────────────────────────────────────
DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.gis",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "django_filters",
    "drf_spectacular",
    "corsheaders",
    "axes",
    "channels",
]

LOCAL_APPS = [
    "core",
    "accounts",
    "laboratories",
    "appointments",
    "analyses",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

# ── Middleware ────────────────────────────────────────────────────────────
MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "axes.middleware.AxesMiddleware",
]

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# ── Database ──────────────────────────────────────────────────────────────
DATABASES = {
    "default": {
        "ENGINE": "django.contrib.gis.db.backends.postgis",
        "NAME": env("POSTGRES_DB"),
        "USER": env("POSTGRES_USER"),
        "PASSWORD": env("POSTGRES_PASSWORD"),
        "HOST": env("POSTGRES_HOST"),
        "PORT": env("POSTGRES_PORT"),
        "CONN_MAX_AGE": 60,
        "ATOMIC_REQUESTS": True,
    }
}

# ── Password hashing ─ Argon2id preferred ─────────────────────────────────
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.BCryptSHA256PasswordHasher",
]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 10},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# django-axes (brute force protection)
AUTHENTICATION_BACKENDS = [
    "axes.backends.AxesStandaloneBackend",
    "accounts.backends.EmailOrPhoneBackend",
]
AXES_FAILURE_LIMIT = 5
AXES_COOLOFF_TIME = timedelta(minutes=15)
AXES_LOCKOUT_PARAMETERS = ["ip_address", "username"]
AXES_RESET_ON_SUCCESS = True

# ── i18n (bilingue FR + AR) ───────────────────────────────────────────────
LANGUAGE_CODE = "fr"
LANGUAGES = [
    ("fr", "Français"),
    ("ar", "العربية"),
]
LOCALE_PATHS = [BASE_DIR / "locale"]
TIME_ZONE = "Africa/Nouakchott"
USE_I18N = True
USE_TZ = True

# ── Static / media ────────────────────────────────────────────────────────
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# ── DRF ───────────────────────────────────────────────────────────────────
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_PAGINATION_CLASS": "core.pagination.DefaultPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
        "rest_framework.filters.SearchFilter",
    ),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        "anon": "100/min",
        "user": "1000/hour",
        "login": "5/min",
        "otp": "12/hour",
        "register": "3/hour",
    },
    "EXCEPTION_HANDLER": "core.exceptions.api_exception_handler",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "LabConnect API",
    "DESCRIPTION": "API for LabConnect — medical lab management in Mauritania.",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
}

# ── JWT (RS256, rotating refresh, blacklist) ──────────────────────────────
def _b64_decode(var: str) -> str:
    raw = env(var, default="")
    return base64.b64decode(raw).decode() if raw else ""


SIMPLE_JWT = {
    "ALGORITHM": "RS256",
    "SIGNING_KEY": _b64_decode("JWT_PRIVATE_KEY_BASE64"),
    "VERIFYING_KEY": _b64_decode("JWT_PUBLIC_KEY_BASE64"),
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
    "TOKEN_TYPE_CLAIM": "token_type",
}

# ── Celery ────────────────────────────────────────────────────────────────
CELERY_BROKER_URL = env("REDIS_URL", default="redis://localhost:6379/0")
CELERY_RESULT_BACKEND = env("REDIS_URL", default="redis://localhost:6379/0")
CELERY_TASK_ACKS_LATE = True
CELERY_TASK_REJECT_ON_WORKER_LOST = True
CELERY_TASK_TIME_LIMIT = 300
CELERY_TASK_SOFT_TIME_LIMIT = 240
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_TASK_DEFAULT_QUEUE = "default"
CELERY_TASK_ROUTES = {
    "notifications.tasks.*": {"queue": "notifications"},
    "results.tasks.generate_pdf": {"queue": "pdf"},
    "reports.tasks.*": {"queue": "reports"},
    "ai.tasks.*": {"queue": "ai"},
    "orders.tasks.process_emergency": {"queue": "critical"},
}

# ── Channels ──────────────────────────────────────────────────────────────
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {"hosts": [env("REDIS_URL", default="redis://localhost:6379/0")]},
    },
}

# ── MinIO (object storage) ────────────────────────────────────────────────
MINIO_ENDPOINT = env("MINIO_ENDPOINT", default="localhost:9000")
MINIO_ACCESS_KEY = env("MINIO_ROOT_USER", default="minioadmin")
MINIO_SECRET_KEY = env("MINIO_ROOT_PASSWORD", default="minioadmin")
MINIO_USE_HTTPS = env.bool("MINIO_USE_HTTPS", default=False)
MINIO_BUCKETS = {
    "prescriptions": env("MINIO_BUCKET_PRESCRIPTIONS", default="prescriptions"),
    "results": env("MINIO_BUCKET_RESULTS", default="results"),
    "ids": env("MINIO_BUCKET_IDS", default="id-documents"),
    "avatars": env("MINIO_BUCKET_AVATARS", default="avatars"),
}

# ── Column-level encryption (django-cryptography-django5) ─────────────────
FIELD_ENCRYPTION_KEY = env("FIELD_ENCRYPTION_KEY", default="")

# ── OTP ───────────────────────────────────────────────────────────────────
OTP_PROVIDER = env("OTP_PROVIDER", default="mock")  # "mock" | "twilio" | "whatsapp"
OTP_CODE_LENGTH = 6
OTP_TTL_SECONDS = 300  # 5 min
OTP_MAX_SEND_PER_WINDOW = 3
OTP_SEND_WINDOW_SECONDS = 15 * 60

TWILIO_ACCOUNT_SID = env("TWILIO_ACCOUNT_SID", default="")
TWILIO_AUTH_TOKEN = env("TWILIO_AUTH_TOKEN", default="")
TWILIO_FROM_NUMBER = env("TWILIO_FROM_NUMBER", default="")

# ── Firebase Auth ─────────────────────────────────────────────────────────
# ID-token de l'app mobile vérifié par accounts.services.firebase. Requis
# pour activer `POST /auth/login/firebase/`. Vide → l'endpoint répond 503.
FIREBASE_PROJECT_ID = env("FIREBASE_PROJECT_ID", default="")

# ── CORS ──────────────────────────────────────────────────────────────────
CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS")
CORS_ALLOW_CREDENTIALS = False

# ── Security headers (tightened in prod) ──────────────────────────────────
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"

# ── Logging ───────────────────────────────────────────────────────────────
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "[{asctime}] {levelname} {name} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "django": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "labconnect": {"handlers": ["console"], "level": "INFO", "propagate": False},
    },
}
