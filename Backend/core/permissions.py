"""Reusable RBAC permissions.

LabConnect maps roles to Django Groups. Each permission class here checks
group membership. For tenant scoping, see `LabScopedQuerysetMixin` below
which filters querysets to the user's laboratory.
"""
from __future__ import annotations

from typing import ClassVar

from rest_framework import permissions
from rest_framework.request import Request
from rest_framework.views import APIView


class RoleNames:
    """Canonical role identifiers (must match Django Group names)."""

    PATIENT = "patient"
    SECRETARY = "secretary"
    NURSE = "nurse"
    TECHNICIAN = "technician"
    BIOLOGIST = "biologist"
    LAB_CHIEF = "lab_chief"

    ALL_STAFF = (SECRETARY, NURSE, TECHNICIAN, BIOLOGIST, LAB_CHIEF)
    ALL = (PATIENT, *ALL_STAFF)


class HasRole(permissions.BasePermission):
    """Base class — subclass with a `required_roles` tuple."""

    required_roles: ClassVar[tuple[str, ...]] = ()

    def has_permission(self, request: Request, view: APIView) -> bool:
        user = request.user
        if not user or not user.is_authenticated:
            return False
        user_roles = set(user.groups.values_list("name", flat=True))
        return bool(user_roles.intersection(self.required_roles))


class IsPatient(HasRole):
    required_roles = (RoleNames.PATIENT,)


class IsSecretary(HasRole):
    required_roles = (RoleNames.SECRETARY,)


class IsNurse(HasRole):
    required_roles = (RoleNames.NURSE,)


class IsTechnician(HasRole):
    required_roles = (RoleNames.TECHNICIAN,)


class IsBiologist(HasRole):
    required_roles = (RoleNames.BIOLOGIST,)


class IsLabChief(HasRole):
    required_roles = (RoleNames.LAB_CHIEF,)


class IsAnyStaff(HasRole):
    required_roles = RoleNames.ALL_STAFF


class Is2FAVerified(permissions.BasePermission):
    """Requires the JWT claim `totp_verified=True`.

    Staff users get this claim set to False on OTP login. They must call
    POST /auth/totp/verify to exchange it for a token where it is True.
    Patient accounts always have totp_verified=True (no 2FA required).
    """

    message = "La vérification 2FA est requise. Vérifiez votre code authentificateur."

    def has_permission(self, request: Request, view: APIView) -> bool:
        user = request.user
        if not user or not user.is_authenticated:
            return False
        # Read the claim directly from the JWT payload
        token = getattr(request, "auth", None)
        if token is None:
            return False
        return bool(getattr(token, "payload", {}).get("totp_verified", False))


class IsStaffAnd2FA(permissions.BasePermission):
    """Convenience: authenticated + any staff role + 2FA verified."""

    message = "Accès réservé au personnel du laboratoire (2FA requis)."

    def has_permission(self, request: Request, view: APIView) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False
        roles = set(request.user.groups.values_list("name", flat=True))
        if not roles.intersection(RoleNames.ALL_STAFF):
            return False
        token = getattr(request, "auth", None)
        return bool(getattr(token, "payload", {}).get("totp_verified", False))


def current_lab_id(request):
    """Resolve the laboratory the current request operates on.

    A user can manage multiple labs (typically the chef de labo). The active
    lab is picked client-side and transmitted either via the ``X-Lab-Uuid``
    HTTP header or the ``lab`` query parameter. If absent, we fall back to
    the user's first StaffProfile.

    Returns the laboratory's primary key (int) or ``None``.
    """
    user = getattr(request, "user", None)
    if not user or not user.is_authenticated:
        return None

    explicit = request.META.get("HTTP_X_LAB_UUID")
    if not explicit and hasattr(request, "query_params"):
        explicit = request.query_params.get("lab")

    from accounts.models import StaffProfile  # local import to avoid cycle

    qs = StaffProfile.active.filter(user=user).values_list("laboratory_id", "laboratory__uuid")
    pairs = list(qs)
    if not pairs:
        return None
    if explicit:
        for pk, uuid in pairs:
            if str(uuid) == str(explicit):
                return pk
    # default: first lab
    return pairs[0][0]


class LabScopedQuerysetMixin:
    """Mixin for staff ViewSets.

    Filters `queryset` to only rows belonging to the laboratory the request
    is currently operating on (see :func:`current_lab_id`).
    """

    lab_lookup_field: str = "laboratory"

    def get_queryset(self):  # type: ignore[no-untyped-def]
        qs = super().get_queryset()  # type: ignore[misc]
        lab = current_lab_id(self.request)  # type: ignore[attr-defined]
        if lab is None:
            return qs.none()
        return qs.filter(**{f"{self.lab_lookup_field}_id": lab})
