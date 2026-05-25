"""Vues RDV — multi-rôles.

Patient :
  - GET  /api/v1/appointments/mine/        — ses propres RDV
  - POST /api/v1/appointments/             — créer un RDV pour soi
  - PATCH /api/v1/appointments/{uuid}/cancel/

Secrétaire (+ chef) :
  - GET  /api/v1/appointments/             — RDV du labo (+ filtres)
  - POST /api/v1/appointments/             — créer pour un patient
  - PATCH /api/v1/appointments/{uuid}/status/

Infirmier :
  - GET  /api/v1/appointments/home-visits/ — visites à domicile à effectuer
  - PATCH /api/v1/appointments/{uuid}/status/
"""
from __future__ import annotations

from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from accounts.models import User
from core.permissions import HasRole, IsStaffAnd2FA, RoleNames, current_lab_id

from .models import Appointment, AppointmentStatus, VisitType
from .serializers import (
    AppointmentCreateSerializer,
    AppointmentSerializer,
    AppointmentStatusSerializer,
)


class IsPatientOrStaff(permissions.BasePermission):
    """Patient OU staff 2FA. Granularité fine ensuite par action."""
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        roles = _user_roles(request.user)
        if RoleNames.PATIENT in roles:
            return True
        if roles.intersection(RoleNames.ALL_STAFF):
            return _has_2fa(request)
        return False


def _user_roles(user) -> set[str]:
    return set(user.groups.values_list("name", flat=True))


def _has_2fa(request) -> bool:
    token = getattr(request, "auth", None)
    return bool(getattr(token, "payload", {}).get("totp_verified", False))


class AppointmentViewSet(viewsets.ModelViewSet):
    permission_classes = (IsPatientOrStaff,)
    lookup_field = "uuid"
    queryset = Appointment.active.all().select_related(
        "laboratory", "patient", "assigned_nurse"
    )

    def get_serializer_class(self):
        if self.action == "create":
            return AppointmentCreateSerializer
        return AppointmentSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        roles = _user_roles(user)
        is_patient_only = roles == {RoleNames.PATIENT}

        # Patient seul → uniquement ses RDV
        if is_patient_only:
            return qs.filter(patient=user)

        # Staff → RDV de leur labo
        lab_id = current_lab_id(self.request)
        if lab_id is None:
            return qs.none()
        qs = qs.filter(laboratory_id=lab_id)

        # Infirmier (sans secrétaire/chef) → uniquement ses visites assignées
        if RoleNames.NURSE in roles and not roles.intersection(
            {RoleNames.SECRETARY, RoleNames.LAB_CHIEF, RoleNames.BIOLOGIST}
        ):
            qs = qs.filter(assigned_nurse=user)

        # Filtres query params
        params = self.request.query_params
        if "status" in params:
            qs = qs.filter(status=params["status"])
        if "visit_type" in params:
            qs = qs.filter(visit_type=params["visit_type"])
        if "date" in params:  # YYYY-MM-DD
            qs = qs.filter(scheduled_for__date=params["date"])
        return qs

    def perform_create(self, serializer):
        # AppointmentCreateSerializer gère patient & lab
        serializer.save()

    @action(detail=False, methods=["get"], url_path="mine")
    def mine(self, request):
        """RDV du patient connecté (raccourci)."""
        qs = Appointment.active.filter(patient=request.user).select_related(
            "laboratory", "assigned_nurse", "patient",
        )
        return Response(AppointmentSerializer(qs, many=True).data)

    @action(detail=False, methods=["get"], url_path="home-visits")
    def home_visits(self, request):
        """Visites à domicile pour l'infirmier connecté."""
        roles = _user_roles(request.user)
        if RoleNames.NURSE not in roles:
            raise PermissionDenied("Réservé aux infirmier·ères.")
        if not _has_2fa(request):
            raise PermissionDenied("2FA requise.")
        qs = Appointment.active.filter(
            visit_type=VisitType.HOME,
            assigned_nurse=request.user,
            status__in=[
                AppointmentStatus.CONFIRMED,
                AppointmentStatus.IN_PROGRESS,
            ],
        ).select_related("laboratory", "patient")
        return Response(AppointmentSerializer(qs, many=True).data)

    @action(detail=True, methods=["patch"], url_path="cancel")
    def cancel(self, request, uuid=None):
        appt = self.get_object()
        roles = _user_roles(request.user)
        # Patient ne peut annuler que ses propres RDV non démarrés
        if roles == {RoleNames.PATIENT}:
            if appt.patient_id != request.user.id:
                raise PermissionDenied("RDV non autorisé.")
            if appt.status not in (AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED):
                raise ValidationError("Ce RDV ne peut plus être annulé.")
        appt.status = AppointmentStatus.CANCELLED
        appt.save(update_fields=["status", "updated_at"])
        return Response(AppointmentSerializer(appt).data)

    @action(detail=True, methods=["patch"], url_path="status")
    def change_status(self, request, uuid=None):
        appt = self.get_object()
        roles = _user_roles(request.user)
        if not roles.intersection(RoleNames.ALL_STAFF):
            raise PermissionDenied("Staff uniquement.")
        if not _has_2fa(request):
            raise PermissionDenied("2FA requise.")

        ser = AppointmentStatusSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        new_status = ser.validated_data["status"]

        # Affecter un infirmier (staff secrétaire / chef peut le faire)
        nurse_uuid = ser.validated_data.get("nurse_uuid")
        if nurse_uuid:
            try:
                nurse = User.objects.get(uuid=nurse_uuid, groups__name=RoleNames.NURSE)
            except User.DoesNotExist as exc:
                raise ValidationError({"nurse_uuid": "Infirmier·e introuvable."}) from exc
            appt.assigned_nurse = nurse

        appt.status = new_status
        appt.save()
        return Response(AppointmentSerializer(appt).data)
