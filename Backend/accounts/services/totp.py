"""TOTP 2FA service — RFC 6238, compatible Google/Microsoft Authenticator.

Uses `pyotp` under the hood. Generates 6-digit codes, 30-second window,
with ±1 window tolerance for clock drift (common on mobile devices in Mauritania
where NTP sync can be unreliable).
"""
from __future__ import annotations

import io
import base64

import pyotp
import qrcode

APP_NAME = "LabConnect"
TOTP_WINDOW = 1  # ±1 step tolerance (30s each side)


def generate_secret() -> str:
    """Generate a cryptographically-secure TOTP secret (32 chars base32)."""
    return pyotp.random_base32()


def get_totp(secret: str) -> pyotp.TOTP:
    return pyotp.TOTP(secret)


def verify_code(secret: str, code: str) -> bool:
    """Return True if `code` is valid for `secret` within the allowed window."""
    totp = get_totp(secret)
    return totp.verify(code, valid_window=TOTP_WINDOW)


def provisioning_uri(secret: str, phone: str) -> str:
    """Build the otpauth:// URI the authenticator app expects."""
    return get_totp(secret).provisioning_uri(
        name=phone,
        issuer_name=APP_NAME,
    )


def qr_code_base64(secret: str, phone: str) -> str:
    """Return a base64-encoded PNG QR code for the provisioning URI.

    The client can display this directly:
        <Image source={{ uri: `data:image/png;base64,${qr}` }} />
    """
    uri = provisioning_uri(secret, phone)
    img = qrcode.make(uri)
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode()
