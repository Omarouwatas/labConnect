"""Firebase Authentication ID-token verification.

Vérifie une JWT émise par Firebase Auth sans la librairie ``firebase-admin``
(qui exige un fichier de service account). On valide nous-mêmes la
signature en récupérant les clés publiques exposées par Google :

    https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com

Ces clés sont mises en cache mémoire (TTL ~6 h, comme l'en-tête HTTP
``Cache-Control`` que Google renvoie).
"""
from __future__ import annotations

import json
import logging
import time
import urllib.request
from typing import Any

import jwt
from cryptography import x509
from cryptography.hazmat.backends import default_backend
from django.conf import settings

logger = logging.getLogger(__name__)

_PUBLIC_KEYS_URL = (
    "https://www.googleapis.com/robot/v1/metadata/x509/"
    "securetoken@system.gserviceaccount.com"
)
_ISSUER_PREFIX = "https://securetoken.google.com/"

# Cache mémoire : {kid: PEM bytes}, expire à `_keys_expire_at` (epoch s).
_keys_cache: dict[str, bytes] = {}
_keys_expire_at: float = 0.0


class FirebaseAuthError(Exception):
    """Raised when a Firebase ID token fails verification."""


def _load_public_keys() -> dict[str, bytes]:
    """Fetch + cache Google's signing certificates (kid → PEM)."""
    global _keys_cache, _keys_expire_at

    now = time.time()
    if _keys_cache and now < _keys_expire_at:
        return _keys_cache

    req = urllib.request.Request(
        _PUBLIC_KEYS_URL,
        headers={"Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        body = resp.read().decode()
        # Cache pendant 1 h par défaut ; Google envoie souvent 6 h dans
        # `Cache-Control: max-age=…`. On reste prudent pour ne pas servir
        # une clé révoquée trop longtemps.
        max_age = 3600
        cache_control = resp.headers.get("Cache-Control", "")
        for part in cache_control.split(","):
            part = part.strip()
            if part.startswith("max-age="):
                try:
                    max_age = int(part.split("=", 1)[1])
                except ValueError:
                    pass

    certs: dict[str, str] = json.loads(body)
    keys: dict[str, bytes] = {}
    for kid, cert_pem in certs.items():
        cert = x509.load_pem_x509_certificate(cert_pem.encode(), default_backend())
        # PyJWT accepte les objets cryptography RSAPublicKey directement.
        keys[kid] = cert.public_key()

    _keys_cache = keys
    _keys_expire_at = now + max_age
    return keys


def verify_id_token(id_token: str) -> dict[str, Any]:
    """Verify a Firebase ID token and return its decoded claims.

    Raises :
        FirebaseAuthError — si la signature, l'issuer, l'audience ou
        l'expiration ne sont pas valides, ou si ``FIREBASE_PROJECT_ID``
        n'est pas configuré.
    """
    project_id = getattr(settings, "FIREBASE_PROJECT_ID", "") or ""
    if not project_id:
        raise FirebaseAuthError(
            "FIREBASE_PROJECT_ID n'est pas configuré côté serveur."
        )

    try:
        header = jwt.get_unverified_header(id_token)
    except jwt.InvalidTokenError as exc:
        raise FirebaseAuthError("Jeton mal formé.") from exc

    kid = header.get("kid")
    if not kid:
        raise FirebaseAuthError("Jeton sans 'kid' — non émis par Firebase.")

    try:
        keys = _load_public_keys()
    except Exception as exc:  # noqa: BLE001 — réseau / parse
        logger.error("Failed to fetch Firebase public keys: %s", exc)
        raise FirebaseAuthError("Clés Firebase indisponibles.") from exc

    public_key = keys.get(kid)
    if not public_key:
        # Le kid n'est pas dans le cache — peut-être que Google a tourné
        # ses clés depuis. On force un re-fetch une fois.
        _keys_cache.clear()
        keys = _load_public_keys()
        public_key = keys.get(kid)
    if not public_key:
        raise FirebaseAuthError("Clé publique introuvable pour ce 'kid'.")

    try:
        claims = jwt.decode(
            id_token,
            key=public_key,
            algorithms=["RS256"],
            audience=project_id,
            issuer=f"{_ISSUER_PREFIX}{project_id}",
            options={"require": ["exp", "iat", "sub", "aud", "iss"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise FirebaseAuthError("Jeton Firebase expiré.") from exc
    except jwt.InvalidAudienceError as exc:
        raise FirebaseAuthError("Mauvais project_id (audience).") from exc
    except jwt.InvalidIssuerError as exc:
        raise FirebaseAuthError("Mauvais émetteur (issuer).") from exc
    except jwt.InvalidTokenError as exc:
        raise FirebaseAuthError(f"Jeton Firebase invalide : {exc}") from exc

    if not claims.get("sub"):
        raise FirebaseAuthError("'sub' manquant.")
    return claims
