"""Authentication models.

Design notes (see backend/README.md §2):
- Single `User` model with phone as identifier; roles are assigned via
  Django Groups (canonical names in core.permissions.RoleNames).
- `PatientProfile` and `StaffProfile` are OneToOne extensions, letting a
  single user theoretically hold both (e.g. a biologist who is also a
  patient of the same system).
- OTP codes are never stored in clear — only SHA-256 hashes with a salt.
"""
from __future__ import annotations

import hashlib
import re
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.contrib.gis.db import models as gis_models
from django.db import models
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from core.models import BaseModel

from .managers import UserManager

PHONE_RE = re.compile(r"^\+?[0-9]{8,15}$")


class User(AbstractBaseUser, PermissionsMixin, BaseModel):
    """Phone-based user.

    Unique constraint: `phone` (E.164 format, + optional).
    """

    class Language(models.TextChoices):
        FR = "fr", _("Français")
        AR = "ar", _("العربية")

    phone = models.CharField(max_length=20, unique=True, null=True, blank=True, db_index=True)
    email = models.EmailField(unique=True, null=True, blank=True, db_index=True)
    first_name = models.CharField(max_length=80, blank=True)
    last_name = models.CharField(max_length=80, blank=True)
    preferred_language = models.CharField(
        max_length=2, choices=Language.choices, default=Language.FR
    )

    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)
    last_login = models.DateTimeField(null=True, blank=True)

    # Phone verification status (updated once OTP verified)
    is_phone_verified = models.BooleanField(default=False)

    USERNAME_FIELD = "phone"
    REQUIRED_FIELDS: list[str] = []

    objects = UserManager()

    class Meta:
        verbose_name = _("user")
        verbose_name_plural = _("users")
        ordering = ("-date_joined",)

    def __str__(self) -> str:
        return self.phone or self.email or str(self.uuid)

    def save(self, *args, **kwargs) -> None:
        if self.email == "":
            self.email = None
        if self.phone == "":
            self.phone = None
        super().save(*args, **kwargs)

    @staticmethod
    def normalize_phone(phone: str | None) -> str | None:
        """Normalize phone number: strip spaces, keep leading +."""
        if not phone:
            return None
        cleaned = re.sub(r"\s+", "", phone.strip())
        if not PHONE_RE.match(cleaned):
            raise ValueError(f"Invalid phone number format: {phone}")
        return cleaned

    def get_full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    def get_short_name(self) -> str:
        return self.first_name or self.phone or self.email or str(self.uuid)


class PatientProfile(BaseModel):
    """Patient-specific fields. OneToOne with User."""

    class Gender(models.TextChoices):
        MALE = "male", _("Homme")
        FEMALE = "female", _("Femme")
        OTHER = "other", _("Autre")

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="patient_profile",
    )
    date_of_birth = models.DateField(null=True, blank=True)
    gender = models.CharField(max_length=10, choices=Gender.choices, blank=True)
    # PHI fields — will be encrypted at column level via django-cryptography-django5
    # once we add the encryption wrapper (§6 of README).
    national_id = models.CharField(max_length=64, blank=True)
    blood_type = models.CharField(max_length=5, blank=True)
    emergency_contact = models.CharField(max_length=20, blank=True)
    default_address = models.CharField(max_length=255, blank=True)
    default_location = gis_models.PointField(geography=True, null=True, blank=True)
    # CNAM (Caisse Nationale d'Assurance Maladie — Mauritanie). Si le
    # patient présente sa carte CNAM au comptoir, on enregistre son numéro
    # et le pourcentage couvert ; les TestOrder créés ensuite figent le
    # split CNAM / patient à ce taux-là (le taux peut évoluer côté CNAM,
    # mais une facture historique doit rester intacte).
    cnam_number = models.CharField(max_length=32, blank=True)
    cnam_coverage_pct = models.PositiveSmallIntegerField(
        default=0,
        help_text="0–100. 0 = pas couvert. Typique CNAM Mauritanie : 80.",
    )

    class Meta:
        verbose_name = _("patient profile")
        verbose_name_plural = _("patient profiles")


class StaffProfile(BaseModel):
    """Staff-specific fields. One per (user, laboratory) pair.

    A user can hold multiple StaffProfiles — for example, a lab chief who
    manages two laboratories will have two profiles, one per lab. The
    permission system uses Django Groups (multi-role), so a single profile
    can also map to several roles inside the same lab.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="staff_profiles",
    )
    laboratory = models.ForeignKey(
        "laboratories.Laboratory",
        on_delete=models.PROTECT,
        related_name="staff_members",
    )
    employee_id = models.CharField(max_length=50, blank=True)
    license_number = models.CharField(max_length=80, blank=True)
    is_on_duty = models.BooleanField(default=True)

    class Meta:
        verbose_name = _("staff profile")
        verbose_name_plural = _("staff profiles")
        constraints = [
            models.UniqueConstraint(
                fields=["user", "laboratory"],
                name="uniq_staff_user_lab",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]


class OTPCode(BaseModel):
    """Ephemeral OTP record.

    We NEVER store the plaintext code — only SHA-256(salt + code). The
    salt is unique per OTP row. Codes expire after `settings.OTP_TTL_SECONDS`.
    """

    class Purpose(models.TextChoices):
        LOGIN = "login", _("Connexion")
        REGISTER = "register", _("Inscription")
        PASSWORD_RESET = "password_reset", _("Réinitialisation mot de passe")
        VERIFY_PHONE = "verify_phone", _("Vérification téléphone")

    phone = models.CharField(max_length=20, db_index=True)
    purpose = models.CharField(max_length=20, choices=Purpose.choices)
    salt = models.CharField(max_length=32)
    code_hash = models.CharField(max_length=64)
    expires_at = models.DateTimeField(db_index=True)
    consumed_at = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)

    class Meta:
        verbose_name = _("OTP code")
        verbose_name_plural = _("OTP codes")
        indexes = [
            models.Index(fields=["phone", "purpose"]),
        ]

    @classmethod
    def hash_code(cls, salt: str, code: str) -> str:
        return hashlib.sha256(f"{salt}:{code}".encode()).hexdigest()

    @classmethod
    def issue(cls, phone: str, purpose: str, code: str) -> "OTPCode":
        salt = secrets.token_hex(16)
        return cls.objects.create(
            phone=phone,
            purpose=purpose,
            salt=salt,
            code_hash=cls.hash_code(salt, code),
            expires_at=timezone.now() + timedelta(seconds=settings.OTP_TTL_SECONDS),
        )

    def verify(self, code: str) -> bool:
        """Return True if code matches and is still usable. Consumes on success."""
        if self.consumed_at is not None:
            return False
        if self.expires_at < timezone.now():
            return False
        self.attempts = models.F("attempts") + 1  # type: ignore[assignment]
        if OTPCode.hash_code(self.salt, code) != self.code_hash:
            self.save(update_fields=["attempts", "updated_at"])
            return False
        self.consumed_at = timezone.now()
        self.save(update_fields=["attempts", "consumed_at", "updated_at"])
        return True

    @property
    def is_expired(self) -> bool:
        return self.expires_at < timezone.now()


class TrustedDevice(BaseModel):
    """Appareil reconnu comme « de confiance » pour le login biométrique.

    Le flow :
      1. L'utilisateur s'authentifie par OTP SMS classique sur son appareil.
      2. L'app propose : « Activer Face ID / empreinte pour les prochaines
         connexions sur cet appareil ? ».
      3. Si oui → POST /auth/biometric/register/ avec un `device_id` stable
         généré côté client (UUID v4 stocké dans le Keychain iOS / Keystore
         Android via expo-secure-store).
      4. Le serveur génère un `device_token` aléatoire (32 bytes), le hash
         (SHA-256) et le persiste. Le token brut est renvoyé UNE SEULE FOIS
         et stocké côté client dans le Keychain / Keystore.
      5. Aux connexions suivantes : Face ID local débloque l'accès au token
         dans le Keychain, l'app fait POST /auth/biometric/login/ avec
         (phone, device_id, device_token), le serveur vérifie le hash et
         émet une nouvelle paire JWT.

    Sécurité :
      - On ne stocke jamais le token brut côté serveur, seulement son hash.
      - Le tuple (user, device_id) est unique : une nouvelle inscription
         sur le même appareil rotate simplement le token.
      - Un seul appareil peut être enregistré par numéro de téléphone (un
         changement de phone côté User ne casse pas la cohérence — on
         re-vérifie `device.user.phone == phone` au login).
      - Le champ `revoked_at` permet à l'utilisateur (ou à un admin) de
         révoquer un appareil compromis sans toucher au compte.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="trusted_devices",
    )
    # Snapshot du numéro qui a validé l'OTP — si l'utilisateur change de
    # téléphone plus tard, le device n'est plus valable.
    phone = models.CharField(max_length=20, db_index=True)
    # UUID v4 généré côté client, stable pour cet install d'app.
    device_id = models.CharField(max_length=64)
    # Hash SHA-256 du token (jamais le token brut).
    token_hash = models.CharField(max_length=64)
    # Métadonnées informatives (pour l'écran « Appareils de confiance »).
    device_label = models.CharField(max_length=120, blank=True)
    platform = models.CharField(max_length=20, blank=True)  # ios | android
    last_used_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = _("trusted device")
        verbose_name_plural = _("trusted devices")
        constraints = [
            models.UniqueConstraint(
                fields=["user", "device_id"], name="uniq_trusted_user_device"
            ),
        ]
        indexes = [
            models.Index(fields=["phone", "device_id"]),
        ]

    @classmethod
    def hash_token(cls, token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    @classmethod
    def issue(
        cls,
        user,
        phone: str,
        device_id: str,
        device_label: str = "",
        platform: str = "",
    ) -> tuple["TrustedDevice", str]:
        """Crée ou rotate le device pour (user, device_id). Retourne (device, token_brut)."""
        token = secrets.token_urlsafe(32)
        device, _created = cls.objects.update_or_create(
            user=user,
            device_id=device_id,
            defaults={
                "phone": phone,
                "device_label": device_label,
                "platform": platform,
                "token_hash": cls.hash_token(token),
                "revoked_at": None,
                "last_used_at": timezone.now(),
            },
        )
        return device, token

    def verify(self, token: str) -> bool:
        if self.revoked_at is not None:
            return False
        return secrets.compare_digest(self.token_hash, self.hash_token(token))


class TOTPDevice(BaseModel):
    """TOTP 2FA device for a staff user (RFC 6238, compatible Google/Microsoft Authenticator).

    One active device per user at a time. The secret is 32 bytes base32-encoded.
    It is stored in clear in the DB for now — column-level encryption added in étape 7.

    Flow:
      1. POST /auth/totp/setup   → generates secret, returns otpauth:// URI + QR PNG
      2. User scans with authenticator app and enters first code to confirm
      3. POST /auth/totp/confirm → verifies code, marks device confirmed=True
      4. On each subsequent login via OTP, staff must call POST /auth/totp/verify
         to get a token with totp_verified=True.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="totp_device",
    )
    secret = models.CharField(max_length=64)  # base32-encoded TOTP secret
    is_confirmed = models.BooleanField(
        default=False,
        help_text="True once the user has scanned + verified the first code.",
    )
    last_used_counter = models.BigIntegerField(
        default=0,
        help_text="Unix timestamp of last accepted code — prevents replay.",
    )

    class Meta:
        verbose_name = _("TOTP device")
        verbose_name_plural = _("TOTP devices")
