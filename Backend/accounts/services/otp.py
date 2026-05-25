"""OTP delivery abstraction.

Today: Twilio SMS (real) + mock (dev/CI).
Tomorrow: WhatsApp Business Cloud API (same interface, new adapter).

Provider is selected via `settings.OTP_PROVIDER` ∈ {"mock", "twilio", "whatsapp"}.
"""
from __future__ import annotations

import logging
import secrets
from abc import ABC, abstractmethod

from django.conf import settings
from django.utils.translation import gettext_lazy as _

logger = logging.getLogger(__name__)


class OTPProvider(ABC):
    """Interface for sending OTP codes to a phone number."""

    @abstractmethod
    def send(self, phone: str, code: str, language: str = "fr") -> None:
        """Deliver `code` to `phone`. Must raise on failure."""


class MockOTPProvider(OTPProvider):
    """Dev-only: logs the code to the console instead of sending it.

    NEVER enable in production. `settings.OTP_PROVIDER="mock"` should be
    rejected by a startup check in prod settings (TODO §7 audit pass).
    """

    def send(self, phone: str, code: str, language: str = "fr") -> None:
        logger.warning("[MOCK-OTP] → phone=%s code=%s lang=%s", phone, code, language)


class TwilioSMSProvider(OTPProvider):
    """Twilio SMS — uses `TWILIO_*` settings."""

    def __init__(self) -> None:
        from twilio.rest import Client

        self._client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        self._from = settings.TWILIO_FROM_NUMBER

    def send(self, phone: str, code: str, language: str = "fr") -> None:
        body = _render_otp_body(code, language)
        self._client.messages.create(body=body, from_=self._from, to=phone)
        logger.info("Twilio OTP sent to %s", phone)


class WhatsAppProvider(OTPProvider):  # pragma: no cover — wired later
    """WhatsApp Business Cloud API — scaffold for when Meta account is ready."""

    def send(self, phone: str, code: str, language: str = "fr") -> None:
        raise NotImplementedError("WhatsApp OTP provider not yet configured")


# ── Factory ───────────────────────────────────────────────────────────────
_PROVIDERS: dict[str, type[OTPProvider]] = {
    "mock": MockOTPProvider,
    "twilio": TwilioSMSProvider,
    "whatsapp": WhatsAppProvider,
}


def get_provider() -> OTPProvider:
    name = settings.OTP_PROVIDER
    try:
        return _PROVIDERS[name]()
    except KeyError as exc:
        raise RuntimeError(
            f"Unknown OTP_PROVIDER={name!r}. Valid: {list(_PROVIDERS)}"
        ) from exc


def generate_code() -> str:
    """Cryptographically-secure n-digit code."""
    n = settings.OTP_CODE_LENGTH
    return "".join(str(secrets.randbelow(10)) for _ in range(n))


def _render_otp_body(code: str, language: str) -> str:
    """Bilingual OTP message body.

    Later: move to i18n templates (§3 README). For now: inline.
    """
    if language == "ar":
        return f"رمز LabConnect الخاص بك: {code}\nصالح لمدة 5 دقائق."
    return f"Votre code LabConnect: {code}\nValide 5 minutes."
