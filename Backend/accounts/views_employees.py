"""Employee management — lab chief only (2FA required).

POST   /api/v1/lab/employees/invite        invite a new staff member by phone
GET    /api/v1/lab/employees/              list team members
GET    /api/v1/lab/employees/{uuid}/       detail
PATCH  /api/v1/lab/employees/{uuid}/       update role or on_duty status
DELETE /api/v1/lab/employees/{uuid}/       deactivate (soft-delete profile)

Invite flow:
  1. Lab chief sends phone + role.
  2. Backend creates User (if not exists) + StaffProfile for this lab + assigns Group.
  3. User receives an OTP on next login attempt (no "welcome SMS" for now — TODO).
  4. New staff must set up TOTP on first login.
"""
from __future__ import annotations

from django.contrib.auth.models import Group
from django.db import transaction
from rest_framework import permissions, serializers, status
from rest_framework.exceptions import ValidationError
from rest_framework.generics import get_object_or_404
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet
from rest_framework import mixins

from core.permissions import IsLabChief, IsStaffAnd2FA, RoleNames, current_lab_id

from .models import PatientProfile, StaffProfile, User
from .views import _assign_role
from laboratories.models import Laboratory


def _resolve_lab(request):
    """Return the Laboratory instance the request is scoped to (or raise)."""
    lab_id = current_lab_id(request)
    if not lab_id:
        raise ValidationError({"lab": "Aucun laboratoire actif. Créez d'abord un laboratoire."})
    return Laboratory.objects.get(pk=lab_id)


# ── Serializers ────────────────────────────────────────────────────────────

_ASSIGNABLE_ROLES = [r for r in RoleNames.ALL_STAFF if r != RoleNames.LAB_CHIEF]


class EmployeeInviteSerializer(serializers.Serializer):
    email = serializers.EmailField()
    phone = serializers.CharField(max_length=20, required=False, default="")
    first_name = serializers.CharField(max_length=80, required=False, default="")
    last_name = serializers.CharField(max_length=80, required=False, default="")
    # Multi-rôles : liste de 1..N rôles parmi secretary/nurse/technician/biologist.
    # lab_chief ne s'assigne pas via cette API.
    roles = serializers.ListField(
        child=serializers.ChoiceField(choices=_ASSIGNABLE_ROLES),
        min_length=1,
        max_length=len(_ASSIGNABLE_ROLES),
    )
    password = serializers.CharField(required=False, default="", write_only=True)
    employee_id = serializers.CharField(max_length=50, required=False, default="")
    license_number = serializers.CharField(max_length=80, required=False, default="")

    def validate_phone(self, value: str) -> str:
        if not value:
            return ""
        try:
            return User.normalize_phone(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def validate_roles(self, value: list[str]) -> list[str]:
        if RoleNames.LAB_CHIEF in value:
            raise serializers.ValidationError(
                "Le rôle chef de labo ne peut pas être assigné via cette API."
            )
        # Dédupliquer en gardant l'ordre.
        return list(dict.fromkeys(value))


class StaffProfileSerializer(serializers.ModelSerializer):
    uuid = serializers.UUIDField(source="user.uuid", read_only=True)
    phone = serializers.CharField(source="user.phone", read_only=True)
    first_name = serializers.CharField(source="user.first_name")
    last_name = serializers.CharField(source="user.last_name")
    email = serializers.EmailField(source="user.email", read_only=True)
    is_active = serializers.BooleanField(source="user.is_active", read_only=True)
    roles = serializers.SerializerMethodField()
    has_2fa = serializers.SerializerMethodField()

    class Meta:
        model = StaffProfile
        fields = (
            "uuid",
            "phone",
            "first_name",
            "last_name",
            "email",
            "employee_id",
            "license_number",
            "is_on_duty",
            "is_active",
            "roles",
            "has_2fa",
        )
        read_only_fields = ("uuid", "phone", "email", "is_active", "roles", "has_2fa")

    def get_roles(self, obj: StaffProfile) -> list[str]:
        return list(obj.user.groups.values_list("name", flat=True))

    def get_has_2fa(self, obj: StaffProfile) -> bool:
        return hasattr(obj.user, "totp_device") and obj.user.totp_device.is_confirmed


class EmployeeUpdateSerializer(serializers.Serializer):
    # Si présent, remplace l'ENSEMBLE des rôles staff de cet employé (sauf lab_chief
    # qui n'est jamais touché par cette API).
    roles = serializers.ListField(
        child=serializers.ChoiceField(choices=_ASSIGNABLE_ROLES),
        min_length=1,
        max_length=len(_ASSIGNABLE_ROLES),
        required=False,
    )
    first_name = serializers.CharField(max_length=80, required=False)
    last_name = serializers.CharField(max_length=80, required=False)
    employee_id = serializers.CharField(max_length=50, required=False)
    license_number = serializers.CharField(max_length=80, required=False)
    is_on_duty = serializers.BooleanField(required=False)

    def validate_roles(self, value: list[str]) -> list[str]:
        return list(dict.fromkeys(value))


# ── Views ──────────────────────────────────────────────────────────────────

class NurseListView(APIView):
    """GET /api/v1/lab/nurses/

    Liste minimaliste des infirmiers actifs du labo courant. Sert
    notamment au sélecteur du modal d'affectation côté écran
    « Tournées ». Accessible à tout staff 2FA (la secrétaire en a
    besoin pour affecter, l'infirmière peut consulter ses collègues).
    """
    permission_classes = (IsStaffAnd2FA,)

    def get(self, request: Request) -> Response:
        lab_id = current_lab_id(request)
        if not lab_id:
            return Response([])
        profiles = (
            StaffProfile.active
            .filter(laboratory_id=lab_id, user__groups__name=RoleNames.NURSE)
            .select_related("user")
            .distinct()
            .order_by("user__first_name", "user__last_name")
        )
        data = [
            {
                "uuid": str(p.user.uuid),
                "first_name": p.user.first_name,
                "last_name": p.user.last_name,
                "phone": p.user.phone or "",
                "email": p.user.email or "",
                "is_on_duty": p.is_on_duty,
                "employee_id": p.employee_id,
            }
            for p in profiles
        ]
        return Response(data)


class EmployeeInviteView(APIView):
    """POST /api/v1/lab/employees/invite"""
    permission_classes = (IsStaffAnd2FA, IsLabChief)

    @transaction.atomic
    def post(self, request: Request) -> Response:
        ser = EmployeeInviteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        lab = _resolve_lab(request)

        email = data["email"].lower()
        phone = data.get("phone") or None

        # Check email or phone not already staff in THIS lab
        if StaffProfile.active.filter(user__email__iexact=email, laboratory=lab).exists():
            return Response(
                {"error": {
                    "code": "already_staff",
                    "detail": "Cette adresse e-mail est déjà enregistrée comme employé dans votre laboratoire.",
                }},
                status=status.HTTP_409_CONFLICT,
            )
        if phone and StaffProfile.active.filter(user__phone=phone, laboratory=lab).exists():
            return Response(
                {"error": {
                    "code": "already_staff",
                    "detail": "Ce numéro de téléphone est déjà enregistré comme employé dans votre laboratoire.",
                }},
                status=status.HTTP_409_CONFLICT,
            )

        # Get or create the User by email
        user = User.objects.filter(email__iexact=email).first()
        created = False
        if not user:
            created = True
            # If no password is provided, generate a random one
            password = data.get("password")
            if not password:
                import secrets
                password = secrets.token_urlsafe(12)

            user = User.objects.create_user(
                email=email,
                phone=phone,
                password=password,
                first_name=data.get("first_name", ""),
                last_name=data.get("last_name", ""),
            )
        else:
            # Update phone and names if they were empty
            updated_fields = []
            if not user.phone and phone:
                user.phone = phone
                updated_fields.append("phone")
            if not user.first_name and data.get("first_name"):
                user.first_name = data.get("first_name")
                updated_fields.append("first_name")
            if not user.last_name and data.get("last_name"):
                user.last_name = data.get("last_name")
                updated_fields.append("last_name")
            if updated_fields:
                user.save(update_fields=[*updated_fields, "updated_at"])

        # If the user was previously a patient-only, they keep their PatientProfile
        # and also get a StaffProfile (dual role is allowed per architecture).
        profile = StaffProfile.objects.create(
            user=user,
            laboratory=lab,
            employee_id=data.get("employee_id", ""),
            license_number=data.get("license_number", ""),
        )

        # Assign all requested staff role Groups (multi-rôle)
        for role_name in data["roles"]:
            _assign_role(user, role_name)

        # Ensure user is active
        if not user.is_active:
            user.is_active = True
            user.save(update_fields=["is_active", "updated_at"])

        return Response(
            StaffProfileSerializer(profile).data,
            status=status.HTTP_201_CREATED,
        )


class EmployeeViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    GenericViewSet,
):
    """GET, PATCH, DELETE on team members."""
    permission_classes = (IsStaffAnd2FA, IsLabChief)
    serializer_class = StaffProfileSerializer
    lookup_field = "user__uuid"
    # Petit nombre de membres par labo — pagination inutile, et ça simplifie
    # côté client (toujours un tableau, jamais {count,results}).
    pagination_class = None

    def get_queryset(self):  # type: ignore[no-untyped-def]
        lab_id = current_lab_id(self.request)
        if not lab_id:
            return StaffProfile.active.none()
        return (
            StaffProfile.active
            .filter(laboratory_id=lab_id)
            .select_related("user", "user__totp_device")
            .prefetch_related("user__groups")
            .exclude(user=self.request.user)  # chief doesn't manage themselves here
        )

    @transaction.atomic
    def update(self, request: Request, *args: object, **kwargs: object) -> Response:
        profile = self.get_object()
        ser = EmployeeUpdateSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        # Update user fields
        user = profile.user
        changed_user = []
        for field in ("first_name", "last_name"):
            if field in data:
                setattr(user, field, data[field])
                changed_user.append(field)
        if changed_user:
            user.save(update_fields=[*changed_user, "updated_at"])

        # Update profile fields
        changed_profile = []
        for field in ("employee_id", "license_number", "is_on_duty"):
            if field in data:
                setattr(profile, field, data[field])
                changed_profile.append(field)
        if changed_profile:
            profile.save(update_fields=[*changed_profile, "updated_at"])

        # Update roles if provided — remplace l'ensemble des rôles staff
        # (sauf lab_chief qui reste tel quel : n'est jamais touché ici).
        if "roles" in data:
            assignable_groups = Group.objects.filter(name__in=_ASSIGNABLE_ROLES)
            user.groups.remove(*assignable_groups)
            for role_name in data["roles"]:
                _assign_role(user, role_name)

        return Response(StaffProfileSerializer(profile).data)

    def destroy(self, request: Request, *args: object, **kwargs: object) -> Response:
        """Deactivate the employee (soft delete + disable account)."""
        profile = self.get_object()
        user = profile.user
        # Soft-delete the StaffProfile
        profile.soft_delete()
        # Remove all assignable staff group memberships (lab_chief preserved)
        assignable_groups = Group.objects.filter(name__in=_ASSIGNABLE_ROLES)
        user.groups.remove(*assignable_groups)
        # If no other StaffProfile exists, mark user inactive
        if not StaffProfile.active.filter(user=user).exists():
            user.is_active = False
            user.save(update_fields=["is_active", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)
