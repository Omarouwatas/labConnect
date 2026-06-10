"""Auth endpoints — OTP request/verify, me, logout.

Flow:
1. POST /api/v1/auth/otp/request   — issues an OTP via configured provider.
2. POST /api/v1/auth/otp/verify    — verifies OTP, returns JWT pair. Creates
                                     the User on first successful verify.
3. GET  /api/v1/auth/me            — current profile.
4. POST /api/v1/auth/logout        — blacklists refresh token.
"""
from __future__ import annotations

from django.db import transaction
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.generics import RetrieveUpdateAPIView
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from django.contrib.auth import authenticate
from rest_framework_simplejwt.tokens import RefreshToken

from core.permissions import RoleNames

from .models import OTPCode, PatientProfile, User
from .serializers import (
    OTPRequestSerializer,
    OTPVerifySerializer,
    UserMeSerializer,
    StaffLoginSerializer,
    GoogleLoginSerializer,
    FirebaseLoginSerializer,
)
from .services.firebase import FirebaseAuthError, verify_id_token as verify_firebase_id_token
from .services.otp import generate_code, get_provider
from .tokens import LabConnectRefreshToken


class OTPRequestView(APIView):
    """Issue an OTP code for a given phone + purpose."""

    permission_classes = (permissions.AllowAny,)
    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = "otp"

    def post(self, request: Request) -> Response:
        ser = OTPRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        phone = ser.validated_data["phone"]
        purpose = ser.validated_data["purpose"]
        language = ser.validated_data["language"]

        # Invalidate any non-consumed OTP of the same (phone, purpose)
        OTPCode.objects.filter(
            phone=phone, purpose=purpose, consumed_at__isnull=True
        ).update(consumed_at=timezone.now())

        code = generate_code()
        OTPCode.issue(phone=phone, purpose=purpose, code=code)
        get_provider().send(phone=phone, code=code, language=language)

        return Response(
            {"sent": True, "ttl_seconds": 300},
            status=status.HTTP_200_OK,
        )


class OTPVerifyView(APIView):
    """Verify OTP, create user if needed, return JWT pair."""

    permission_classes = (permissions.AllowAny,)
    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = "login"

    @transaction.atomic
    def post(self, request: Request) -> Response:
        ser = OTPVerifySerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        phone = ser.validated_data["phone"]
        code = ser.validated_data["code"]
        purpose = ser.validated_data["purpose"]

        # On exige systématiquement un code OTP réel émis par OTPCode.issue.
        # En dev (OTP_PROVIDER=mock), le code est simplement loggé en console
        # Django par MockOTPProvider — le développeur le recopie. Plus aucun
        # bypass "n'importe quel code à 6 chiffres" : l'app mobile et le
        # backend partagent désormais une vraie boucle 2FA.
        otp = (
            OTPCode.objects.filter(
                phone=phone, purpose=purpose, consumed_at__isnull=True
            )
            .order_by("-created_at")
            .first()
        )
        if not otp or not otp.verify(code):
            return Response(
                {"error": {"code": "invalid_otp", "detail": "Code invalide ou expiré"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get-or-create the User. New patients get auto-added to 'patient' group.
        user, created = User.objects.get_or_create(phone=phone)
        if created:
            user.is_phone_verified = True
            user.save(update_fields=["is_phone_verified", "updated_at"])
            PatientProfile.objects.create(user=user)
            _assign_role(user, RoleNames.PATIENT)
        elif not user.is_phone_verified:
            user.is_phone_verified = True
            user.save(update_fields=["is_phone_verified", "updated_at"])

        refresh = LabConnectRefreshToken.for_user(user)
        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "user": UserMeSerializer(user).data,
            },
            status=status.HTTP_200_OK,
        )


class MeView(RetrieveUpdateAPIView):
    """Get or update the current authenticated user.

    On garantit l'existence du `PatientProfile` à chaque accès — comme ça
    UserMeSerializer peut exposer les champs CNAM / adresse / GPS via
    `source="patient_profile.X"` sans risquer un RelatedObjectDoesNotExist
    sur les comptes staff qui n'auraient pas (encore) de profil patient.
    """

    serializer_class = UserMeSerializer
    permission_classes = (permissions.IsAuthenticated,)

    def get_object(self) -> User:  # type: ignore[override]
        PatientProfile.objects.get_or_create(user=self.request.user)
        return self.request.user  # type: ignore[return-value]


class LogoutView(APIView):
    """Blacklist a refresh token."""

    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request: Request) -> Response:
        token = request.data.get("refresh")
        if not token:
            return Response(
                {"error": {"code": "missing_refresh", "detail": "refresh required"}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            RefreshToken(token).blacklist()
        except Exception as exc:  # noqa: BLE001 — simplejwt raises various
            return Response(
                {"error": {"code": "invalid_refresh", "detail": str(exc)}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


def _assign_role(user: User, role: str) -> None:
    """Assign a Django Group by name, creating it if missing."""
    from django.contrib.auth.models import Group

    group, _ = Group.objects.get_or_create(name=role)
    user.groups.add(group)


import json
import urllib.request
import logging

logger = logging.getLogger(__name__)


def verify_google_token(id_token: str) -> dict | None:
    """Verify a Google ID Token using the official Google endpoint."""
    try:
        url = f"https://oauth2.googleapis.com/tokeninfo?id_token={id_token}"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode())
            email = data.get("email")
            if email:
                return data
    except Exception as e:
        logger.error(f"Error validating Google ID Token: {e}")
    return None


class PatientEmailLoginView(APIView):
    """Authenticate any user (patient or staff) by email + password.

    Utilisé par l'app mobile patient. Aucun check de rôle (un patient,
    un staff, ou même un compte mixte peut se connecter). Le frontend
    décide ensuite quoi afficher en fonction de `roles` dans le profil.
    """
    permission_classes = (permissions.AllowAny,)
    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = "login"

    def post(self, request: Request) -> Response:
        ser = StaffLoginSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        email = ser.validated_data["email"]
        password = ser.validated_data["password"]

        user = authenticate(request, username=email, password=password)
        if not user:
            return Response(
                {"error": {"code": "invalid_credentials", "detail": "Email ou mot de passe incorrect"}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        refresh = LabConnectRefreshToken.for_user(user)
        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "user": UserMeSerializer(user).data,
            },
            status=status.HTTP_200_OK,
        )


class StaffLoginView(APIView):
    """Authenticate staff member via email and password."""

    permission_classes = (permissions.AllowAny,)
    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = "login"

    def post(self, request: Request) -> Response:
        ser = StaffLoginSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        email = ser.validated_data["email"]
        password = ser.validated_data["password"]

        user = authenticate(request, username=email, password=password)

        if not user:
            return Response(
                {"error": {"code": "invalid_credentials", "detail": "Email ou mot de passe incorrect"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not _user_is_staff(user):
            return Response(
                {"error": {"code": "access_denied", "detail": "Accès réservé au personnel du laboratoire"}},
                status=status.HTTP_403_FORBIDDEN,
            )

        refresh = LabConnectRefreshToken.for_user(user)
        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "user": UserMeSerializer(user).data,
            },
            status=status.HTTP_200_OK,
        )


def _user_is_staff(user: User) -> bool:
    """True if user has any staff role, a StaffProfile, or Django staff flag."""
    has_staff_profile = user.staff_profiles.filter(deleted_at__isnull=True).exists()
    has_staff_role = user.groups.filter(name__in=RoleNames.ALL_STAFF).exists()
    return has_staff_profile or has_staff_role or user.is_staff or user.is_superuser


class PatientGoogleLoginView(APIView):
    """Patient (mobile) Google sign-in / sign-up via Google ID Token.

    Diffère de `GoogleLoginView` (staff) sur deux points :
      - **Auto-création** du compte si l'email n'existe pas → un
        `PatientProfile` est créé et le rôle `patient` est assigné.
      - **Aucun check** de rôle staff : tout utilisateur authentifié par
        Google peut se connecter (patient ou staff).
    """

    permission_classes = (permissions.AllowAny,)
    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = "login"

    @transaction.atomic
    def post(self, request: Request) -> Response:
        ser = GoogleLoginSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        id_token = ser.validated_data["id_token"]

        google_data = verify_google_token(id_token)
        if not google_data:
            return Response(
                {"error": {"code": "invalid_google_token", "detail": "Jeton Google invalide ou expiré"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        email = google_data.get("email", "").lower().strip()
        if not email:
            return Response(
                {"error": {"code": "no_email", "detail": "Le compte Google n'a pas d'email vérifié."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = User.objects.filter(email__iexact=email).first()
        created = False
        if not user:
            # Auto-création du patient à la première connexion Google
            user = User.objects.create_user(
                email=email,
                first_name=google_data.get("given_name", ""),
                last_name=google_data.get("family_name", ""),
            )
            PatientProfile.objects.create(user=user)
            _assign_role(user, RoleNames.PATIENT)
            user.is_active = True
            user.save(update_fields=["is_active", "updated_at"])
            created = True
        else:
            # Mise à jour des noms si absents
            updates = []
            if not user.first_name and google_data.get("given_name"):
                user.first_name = google_data["given_name"]; updates.append("first_name")
            if not user.last_name and google_data.get("family_name"):
                user.last_name = google_data["family_name"]; updates.append("last_name")
            if updates:
                user.save(update_fields=[*updates, "updated_at"])

        refresh = LabConnectRefreshToken.for_user(user)
        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "user": UserMeSerializer(user).data,
                "created": created,
            },
            status=status.HTTP_200_OK,
        )


class GoogleLoginView(APIView):
    """Authenticate staff member via Google OAuth2 ID Token."""

    permission_classes = (permissions.AllowAny,)
    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = "login"

    def post(self, request: Request) -> Response:
        ser = GoogleLoginSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        id_token = ser.validated_data["id_token"]

        google_data = verify_google_token(id_token)
        if not google_data:
            return Response(
                {"error": {"code": "invalid_google_token", "detail": "Jeton Google invalide ou expiré"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        email = google_data.get("email")
        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            return Response(
                {"error": {"code": "user_not_found", "detail": "Aucun compte correspondant à cet e-mail n'a été trouvé. Veuillez contacter votre administrateur de laboratoire."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not _user_is_staff(user):
            return Response(
                {"error": {"code": "access_denied", "detail": "Accès réservé au personnel du laboratoire"}},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Check if Google name fields can update user profile (if empty)
        updated = False
        if not user.first_name and google_data.get("given_name"):
            user.first_name = google_data.get("given_name")
            updated = True
        if not user.last_name and google_data.get("family_name"):
            user.last_name = google_data.get("family_name")
            updated = True
        if updated:
            user.save(update_fields=["first_name", "last_name", "updated_at"])

        refresh = LabConnectRefreshToken.for_user(user)
        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "user": UserMeSerializer(user).data,
            },
            status=status.HTTP_200_OK,
        )


class FirebaseLoginView(APIView):
    """Patient sign-in via Firebase Auth (mobile only).

    Le client mobile s'authentifie avec Firebase (email/password OU Google
    via Firebase Credential), récupère le ``getIdToken()`` du
    ``currentUser`` Firebase, et nous l'envoie. On vérifie la JWT côté
    serveur avec les clés publiques de Google (cf. services/firebase.py),
    puis on fait du find-or-create patient et on émet un JWT LabConnect.

    Pas de check de rôle : tout utilisateur Firebase peut se connecter
    en tant que patient. Pour un compte staff, l'admin doit toujours
    passer par l'invitation ``/lab/employees/invite``.
    """

    permission_classes = (permissions.AllowAny,)
    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = "login"

    @transaction.atomic
    def post(self, request: Request) -> Response:
        ser = FirebaseLoginSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        from django.conf import settings as dj_settings
        if not getattr(dj_settings, "FIREBASE_PROJECT_ID", ""):
            return Response(
                {"error": {"code": "firebase_not_configured",
                           "detail": "Firebase n'est pas activé sur ce serveur."}},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        try:
            claims = verify_firebase_id_token(ser.validated_data["id_token"])
        except FirebaseAuthError as exc:
            return Response(
                {"error": {"code": "invalid_firebase_token", "detail": str(exc)}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        email = (claims.get("email") or "").lower().strip()
        if not email:
            return Response(
                {"error": {"code": "no_email",
                           "detail": "Le compte Firebase n'a pas d'email."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not claims.get("email_verified", False):
            logger.info("Firebase login with unverified email: %s", email)

        user = User.objects.filter(email__iexact=email).first()
        created = False
        if not user:
            full_name = (claims.get("name") or "").strip()
            first_name, _, last_name = full_name.partition(" ")
            user = User.objects.create_user(
                email=email,
                first_name=first_name,
                last_name=last_name,
            )
            PatientProfile.objects.create(user=user)
            _assign_role(user, RoleNames.PATIENT)
            user.is_active = True
            user.save(update_fields=["is_active", "updated_at"])
            created = True
        else:
            updates = []
            full_name = (claims.get("name") or "").strip()
            if full_name:
                first_name, _, last_name = full_name.partition(" ")
                if not user.first_name and first_name:
                    user.first_name = first_name; updates.append("first_name")
                if not user.last_name and last_name:
                    user.last_name = last_name; updates.append("last_name")
            if updates:
                user.save(update_fields=[*updates, "updated_at"])

        refresh = LabConnectRefreshToken.for_user(user)
        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "user": UserMeSerializer(user).data,
                "created": created,
            },
            status=status.HTTP_200_OK,
        )
