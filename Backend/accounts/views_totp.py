"""TOTP 2FA endpoints.

POST /auth/totp/setup    — generate secret + QR code (staff only)
POST /auth/totp/confirm  — activate device after first scan (staff only)
POST /auth/totp/verify   — verify code at login → returns totp_verified=True token
DELETE /auth/totp/device — remove device (lab chief only, for team management)
"""
from __future__ import annotations

from django.utils import timezone
from rest_framework import permissions, serializers, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsAnyStaff

from .models import TOTPDevice
from .services import totp as totp_svc
from .tokens import LabConnectAccessToken, LabConnectRefreshToken


# ── Serializers ────────────────────────────────────────────────────────────

class TOTPVerifySerializer(serializers.Serializer):
    code = serializers.CharField(min_length=6, max_length=6)


# ── Views ──────────────────────────────────────────────────────────────────

class TOTPSetupView(APIView):
    """Generate a new TOTP secret for the current user.

    Returns a base64 QR code PNG + the raw otpauth:// URI.
    If a device already exists and is NOT confirmed, it is replaced.
    If it IS confirmed, returns 409 (must delete first).
    """
    permission_classes = (permissions.IsAuthenticated, IsAnyStaff)

    def post(self, request: Request) -> Response:
        user = request.user
        existing = TOTPDevice.objects.filter(user=user).first()
        if existing and existing.is_confirmed:
            return Response(
                {"error": {"code": "totp_already_configured",
                           "detail": "Un dispositif 2FA est déjà activé. Supprimez-le d'abord."}},
                status=status.HTTP_409_CONFLICT,
            )
        secret = totp_svc.generate_secret()
        if existing:
            existing.secret = secret
            existing.is_confirmed = False
            existing.last_used_counter = 0
            existing.deleted_at = None
            existing.save(update_fields=["secret", "is_confirmed", "last_used_counter", "deleted_at", "updated_at"])
        else:
            TOTPDevice.objects.create(user=user, secret=secret)
        identifier = user.email or user.phone or str(user.uuid)
        return Response(
            {
                "secret": secret,
                "otpauth_uri": totp_svc.provisioning_uri(secret, identifier),
                "qr_code_base64": totp_svc.qr_code_base64(secret, identifier),
            },
            status=status.HTTP_200_OK,
        )


class TOTPConfirmView(APIView):
    """Confirm the TOTP setup by verifying the first code from the authenticator."""
    permission_classes = (permissions.IsAuthenticated, IsAnyStaff)

    def post(self, request: Request) -> Response:
        ser = TOTPVerifySerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        code = ser.validated_data["code"]

        device = TOTPDevice.objects.filter(user=request.user, deleted_at__isnull=True).first()
        if not device:
            return Response(
                {"error": {"code": "totp_not_setup",
                           "detail": "Aucun dispositif 2FA en cours de configuration."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if device.is_confirmed:
            return Response(
                {"error": {"code": "totp_already_confirmed",
                           "detail": "Le dispositif 2FA est déjà confirmé."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not totp_svc.verify_code(device.secret, code):
            return Response(
                {"error": {"code": "invalid_totp_code",
                           "detail": "Code invalide ou expiré. Vérifiez l'heure de votre téléphone."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        device.is_confirmed = True
        device.last_used_counter = int(timezone.now().timestamp())
        device.save(update_fields=["is_confirmed", "last_used_counter", "updated_at"])

        return Response({"configured": True}, status=status.HTTP_200_OK)


class TOTPVerifyView(APIView):
    """Verify TOTP code during login. Returns a new JWT pair with totp_verified=True.

    Called AFTER /auth/otp/verify (OTP phone) — the second authentication step.
    The current access token must be valid but may have totp_verified=False.
    """
    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request: Request) -> Response:
        ser = TOTPVerifySerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        code = ser.validated_data["code"]
        user = request.user

        device = TOTPDevice.objects.filter(
            user=user, is_confirmed=True, deleted_at__isnull=True
        ).first()
        if not device:
            return Response(
                {"error": {"code": "totp_not_configured",
                           "detail": "La 2FA n'est pas configurée pour ce compte."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not totp_svc.verify_code(device.secret, code):
            return Response(
                {"error": {"code": "invalid_totp_code",
                           "detail": "Code invalide ou expiré."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        device.last_used_counter = int(timezone.now().timestamp())
        device.save(update_fields=["last_used_counter", "updated_at"])

        # Issue new JWT pair with totp_verified=True
        refresh = LabConnectRefreshToken.for_user(user)
        access = refresh.access_token
        access["totp_verified"] = True

        return Response(
            {"access": str(access), "refresh": str(refresh)},
            status=status.HTTP_200_OK,
        )


class TOTPDeviceDeleteView(APIView):
    """Remove the TOTP device (self-removal or lab chief removing a team member's)."""
    permission_classes = (permissions.IsAuthenticated,)

    def delete(self, request: Request) -> Response:
        device = TOTPDevice.objects.filter(
            user=request.user, deleted_at__isnull=True
        ).first()
        if not device:
            return Response(status=status.HTTP_404_NOT_FOUND)
        device.soft_delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
