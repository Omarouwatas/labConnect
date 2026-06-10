"""Biometric (Face ID / fingerprint) auth endpoints.

Le mobile gère la biométrie *localement* (TouchID/FaceID/empreinte). Le
backend ne sait rien du visage ou du doigt : il ne fait que vérifier
qu'un (phone, device_id, device_token) correspond à un TrustedDevice
non révoqué, puis il émet une paire JWT comme pour un OTP réussi.

C'est la même garantie de sécurité qu'un « se souvenir de moi » long :
si l'appareil est volé et déverrouillé, l'attaquant a accès au compte.
La protection vient du fait que le `device_token` est verrouillé dans
le Secure Enclave / Keystore et que sa lecture exige Face ID — donc
l'attaquant a besoin du visage *et* de l'appareil.

Endpoints :
  POST   /auth/biometric/check/      (public)  → { eligible: bool }
  POST   /auth/biometric/register/   (auth)    → { device_token }   (1 fois)
  POST   /auth/biometric/login/      (public)  → { access, refresh, user }
  POST   /auth/biometric/revoke/     (auth)    → 204
"""
from __future__ import annotations

from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .models import TrustedDevice, User
from .serializers import UserMeSerializer
from .tokens import LabConnectRefreshToken


def _norm(value) -> str:
    return (value or "").strip() if isinstance(value, str) else ""


class BiometricCheckView(APIView):
    """Le couple (phone, device_id) a-t-il un appareil de confiance actif ?

    Public : l'app interroge ce endpoint au démarrage pour décider
    d'afficher ou non le bouton « Se connecter avec Face ID ». On ne
    révèle aucune info personnelle, juste un booléen.
    """

    permission_classes = (permissions.AllowAny,)
    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = "login"

    def post(self, request: Request) -> Response:
        phone = _norm(request.data.get("phone"))
        device_id = _norm(request.data.get("device_id"))
        if not phone or not device_id:
            return Response({"eligible": False})
        try:
            phone = User.normalize_phone(phone)
        except ValueError:
            return Response({"eligible": False})
        exists = TrustedDevice.objects.filter(
            phone=phone, device_id=device_id, revoked_at__isnull=True
        ).exists()
        return Response({"eligible": exists})


class BiometricRegisterView(APIView):
    """Enregistre l'appareil courant après une session OTP valide.

    L'utilisateur est déjà authentifié (JWT issu de /auth/otp/verify).
    On crée — ou on rotate si déjà existant — un TrustedDevice et on
    renvoie le `device_token` brut UNE SEULE FOIS. À stocker côté client
    dans le Keychain / Keystore.
    """

    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request: Request) -> Response:
        user = request.user
        if not user.phone:
            return Response(
                {"error": {"code": "no_phone",
                           "detail": "Ce compte n'a pas de téléphone vérifié."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        device_id = _norm(request.data.get("device_id"))
        if not device_id or len(device_id) < 8:
            return Response(
                {"error": {"code": "invalid_device_id",
                           "detail": "Identifiant d'appareil manquant ou invalide."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        device_label = _norm(request.data.get("device_label"))[:120]
        platform = _norm(request.data.get("platform"))[:20]

        device, token = TrustedDevice.issue(
            user=user,
            phone=user.phone,
            device_id=device_id,
            device_label=device_label,
            platform=platform,
        )
        return Response(
            {
                "device_token": token,
                "device_uuid": str(device.uuid),
                "phone": user.phone,
            },
            status=status.HTTP_201_CREATED,
        )


class BiometricLoginView(APIView):
    """Échange un (phone, device_id, device_token) contre une paire JWT."""

    permission_classes = (permissions.AllowAny,)
    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = "login"

    def post(self, request: Request) -> Response:
        phone = _norm(request.data.get("phone"))
        device_id = _norm(request.data.get("device_id"))
        device_token = _norm(request.data.get("device_token"))
        if not phone or not device_id or not device_token:
            return Response(
                {"error": {"code": "missing_fields",
                           "detail": "phone, device_id, device_token requis."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            phone = User.normalize_phone(phone)
        except ValueError:
            return Response(
                {"error": {"code": "invalid_phone", "detail": "Numéro invalide."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        device = (
            TrustedDevice.objects.select_related("user")
            .filter(phone=phone, device_id=device_id, revoked_at__isnull=True)
            .first()
        )
        if not device or not device.verify(device_token):
            return Response(
                {"error": {"code": "invalid_device",
                           "detail": "Cet appareil n'est plus reconnu. Reconnectez-vous par SMS."}},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        # Sécurité : si l'utilisateur a changé de téléphone côté serveur
        # depuis l'enregistrement de l'appareil, on bloque pour forcer un
        # nouveau cycle 2FA.
        if device.user.phone != phone:
            return Response(
                {"error": {"code": "phone_mismatch",
                           "detail": "Le numéro associé à cet appareil a changé."}},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        if not device.user.is_active:
            return Response(
                {"error": {"code": "user_inactive", "detail": "Compte désactivé."}},
                status=status.HTTP_403_FORBIDDEN,
            )

        device.last_used_at = timezone.now()
        device.save(update_fields=["last_used_at", "updated_at"])

        refresh = LabConnectRefreshToken.for_user(device.user)
        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "user": UserMeSerializer(device.user).data,
            },
            status=status.HTTP_200_OK,
        )


class BiometricRevokeView(APIView):
    """Désactive l'appareil de confiance courant (logout biométrique).

    L'app appellera ce endpoint quand l'utilisateur clique « Désactiver
    Face ID » dans son profil. Soft delete : on garde la trace pour audit.
    """

    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request: Request) -> Response:
        device_id = _norm(request.data.get("device_id"))
        if not device_id:
            return Response(
                {"error": {"code": "missing_device_id",
                           "detail": "device_id requis."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        updated = TrustedDevice.objects.filter(
            user=request.user, device_id=device_id, revoked_at__isnull=True
        ).update(revoked_at=timezone.now())
        if not updated:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)
