"""Vues analyses, échantillons & résultats — multi-rôles.

Catalogue :
  GET    /api/v1/lab/catalog/                  — public (patient peut voir)
  POST   /api/v1/lab/catalog/                  — chef de labo
  PATCH  /api/v1/lab/catalog/{uuid}/           — chef de labo
  DELETE /api/v1/lab/catalog/{uuid}/           — chef de labo (soft delete)

Samples :
  POST   /api/v1/lab/samples/                  — secrétaire / infirmier
  GET    /api/v1/lab/samples/                  — staff du labo
  PATCH  /api/v1/lab/samples/{uuid}/receive/   — technicien (réception)
  PATCH  /api/v1/lab/samples/{uuid}/reject/    — technicien

Orders & Results :
  GET   /api/v1/lab/orders/                    — staff du labo (filtres status)
  POST  /api/v1/lab/orders/{uuid}/result/      — technicien (saisie)
  PATCH /api/v1/lab/orders/{uuid}/result/      — biologiste (validation)
  GET   /api/v1/results/mine/                  — patient connecté (résultats validés)
"""
from __future__ import annotations

from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from core.permissions import HasRole, IsStaffAnd2FA, RoleNames, current_lab_id

from .models import (
    OrderStatus,
    Sample,
    SampleStatus,
    TestCatalogEntry,
    TestOrder,
    TestResult,
)
from .serializers import (
    SampleCreateSerializer,
    SampleSerializer,
    TestCatalogSerializer,
    TestOrderSerializer,
    TestResultCreateSerializer,
    TestResultSerializer,
    TestResultValidateSerializer,
)


# ── Helpers ──────────────────────────────────────────────────────────

def _roles(user) -> set[str]:
    return set(user.groups.values_list("name", flat=True))

def _require_2fa(request):
    token = getattr(request, "auth", None)
    return bool(getattr(token, "payload", {}).get("totp_verified", False))


class HasAnyRole(permissions.BasePermission):
    required_roles: tuple[str, ...] = ()
    require_2fa: bool = True
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if not _roles(request.user).intersection(self.required_roles):
            return False
        if self.require_2fa and not _require_2fa(request):
            return False
        return True


# ── Catalogue ────────────────────────────────────────────────────────

class CatalogViewSet(viewsets.ModelViewSet):
    """Catalogue d'analyses du labo."""
    serializer_class = TestCatalogSerializer
    queryset = TestCatalogEntry.active.all()
    lookup_field = "uuid"

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [permissions.IsAuthenticated()]
        # create / update / destroy → chef de labo + 2FA
        class _ChiefPerm(HasAnyRole):
            required_roles = (RoleNames.LAB_CHIEF,)
        return [_ChiefPerm()]

    def get_queryset(self):
        qs = super().get_queryset()
        # Si staff → catalogue de leur labo
        lab_id = current_lab_id(self.request)
        if lab_id:
            return qs.filter(laboratory_id=lab_id)
        # Sinon (patient) : on exige ?lab=<uuid> en query param
        lab_uuid = self.request.query_params.get("lab")
        if lab_uuid:
            return qs.filter(laboratory__uuid=lab_uuid, is_active=True)
        return qs.filter(is_active=True)

    def perform_create(self, serializer):
        lab_id = current_lab_id(self.request)
        if not lab_id:
            raise ValidationError("Aucun labo associé à votre compte.")
        serializer.save(laboratory_id=lab_id)

    def destroy(self, request, *args, **kwargs):
        obj = self.get_object()
        obj.soft_delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ── Samples ──────────────────────────────────────────────────────────

class SampleViewSet(viewsets.ModelViewSet):
    """Échantillons — création par secrétaire/infirmier, réception par technicien."""
    queryset = Sample.active.all().select_related(
        "appointment", "appointment__patient", "laboratory"
    )
    lookup_field = "uuid"

    def get_serializer_class(self):
        return SampleCreateSerializer if self.action == "create" else SampleSerializer

    def get_permissions(self):
        if self.action == "create":
            class _Creators(HasAnyRole):
                required_roles = (RoleNames.SECRETARY, RoleNames.NURSE, RoleNames.LAB_CHIEF)
            return [_Creators()]
        if self.action in ("receive", "reject"):
            class _Techs(HasAnyRole):
                required_roles = (RoleNames.TECHNICIAN, RoleNames.BIOLOGIST, RoleNames.LAB_CHIEF)
            return [_Techs()]
        # list / retrieve → tout staff du labo
        return [IsStaffAnd2FA()]

    def get_queryset(self):
        qs = super().get_queryset()
        lab_id = current_lab_id(self.request)
        if not lab_id:
            return qs.none()
        qs = qs.filter(laboratory_id=lab_id)
        if "status" in self.request.query_params:
            qs = qs.filter(status=self.request.query_params["status"])
        return qs

    @action(detail=True, methods=["patch"], url_path="receive")
    def receive(self, request, uuid=None):
        sample = self.get_object()
        if sample.status not in (SampleStatus.COLLECTED, SampleStatus.PENDING):
            raise ValidationError("Échantillon déjà réceptionné ou rejeté.")
        sample.status = SampleStatus.RECEIVED
        sample.received_at = timezone.now()
        sample.received_by = request.user
        sample.save(update_fields=["status", "received_at", "received_by", "updated_at"])
        # Mettre les orders en in_progress
        sample.orders.filter(status=OrderStatus.PENDING).update(
            status=OrderStatus.IN_PROGRESS, started_at=timezone.now(), technician=request.user
        )
        return Response(SampleSerializer(sample).data)

    @action(detail=True, methods=["patch"], url_path="reject")
    def reject(self, request, uuid=None):
        sample = self.get_object()
        reason = request.data.get("reason", "")
        if not reason:
            raise ValidationError({"reason": "Motif requis."})
        sample.status = SampleStatus.REJECTED
        sample.rejection_reason = reason
        sample.save(update_fields=["status", "rejection_reason", "updated_at"])
        sample.orders.update(status=OrderStatus.REJECTED)
        return Response(SampleSerializer(sample).data)


# ── Orders + Results ─────────────────────────────────────────────────

class OrderViewSet(viewsets.ReadOnlyModelViewSet):
    """Liste des ordres pour le staff du labo + actions résultats."""
    serializer_class = TestOrderSerializer
    queryset = TestOrder.active.all().select_related("test", "sample__appointment__patient")
    lookup_field = "uuid"
    permission_classes = (IsStaffAnd2FA,)

    def get_queryset(self):
        qs = super().get_queryset()
        lab_id = current_lab_id(self.request)
        if not lab_id:
            return qs.none()
        qs = qs.filter(sample__laboratory_id=lab_id)
        params = self.request.query_params
        if "status" in params:
            qs = qs.filter(status=params["status"])
        # Technicien sans biologiste → uniquement les ordres pour lui ou non assignés
        roles = _roles(self.request.user)
        if RoleNames.TECHNICIAN in roles and not roles.intersection(
            {RoleNames.BIOLOGIST, RoleNames.LAB_CHIEF}
        ):
            qs = qs.filter(technician__in=[self.request.user, None])
        return qs

    @action(detail=True, methods=["post", "get", "patch"], url_path="result")
    def result(self, request, uuid=None):
        order = self.get_object()
        roles = _roles(request.user)

        if request.method == "GET":
            if not hasattr(order, "result"):
                return Response(status=status.HTTP_404_NOT_FOUND)
            return Response(TestResultSerializer(order.result).data)

        if request.method == "POST":
            # Saisie technicien
            if not roles.intersection({RoleNames.TECHNICIAN, RoleNames.BIOLOGIST, RoleNames.LAB_CHIEF}):
                raise PermissionDenied("Réservé au technicien / biologiste.")
            if order.status not in (OrderStatus.IN_PROGRESS, OrderStatus.PENDING):
                raise ValidationError("Cet ordre n'est plus modifiable.")
            if hasattr(order, "result"):
                raise ValidationError("Un résultat existe déjà — utilisez PATCH pour valider.")
            ser = TestResultCreateSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            from django.db import transaction
            with transaction.atomic():
                result = TestResult.objects.create(order=order, **ser.validated_data)
                order.status = OrderStatus.COMPLETED
                order.completed_at = timezone.now()
                if order.technician_id is None:
                    order.technician = request.user
                order.save(update_fields=["status", "completed_at", "technician", "updated_at"])
            return Response(TestResultSerializer(result).data, status=status.HTTP_201_CREATED)

        # PATCH → validation biologiste
        if RoleNames.BIOLOGIST not in roles and RoleNames.LAB_CHIEF not in roles:
            raise PermissionDenied("Validation réservée au biologiste / chef de labo.")
        if not hasattr(order, "result"):
            raise ValidationError("Aucun résultat saisi à valider.")
        ser = TestResultValidateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        result = order.result
        result.biologist = request.user
        result.biologist_validated_at = timezone.now()
        result.biologist_comment = ser.validated_data.get("biologist_comment", "")
        result.save(update_fields=[
            "biologist", "biologist_validated_at", "biologist_comment", "updated_at"
        ])
        order.status = OrderStatus.VALIDATED
        order.save(update_fields=["status", "updated_at"])
        return Response(TestResultSerializer(result).data)


# ── Patient : voir ses propres résultats validés ─────────────────────

class MyResultsView(viewsets.ViewSet):
    """GET /api/v1/results/mine/ — patient."""
    permission_classes = (permissions.IsAuthenticated,)

    def list(self, request):
        results = TestResult.active.filter(
            order__sample__appointment__patient=request.user,
            biologist_validated_at__isnull=False,
        ).select_related(
            "order__test",
            "order__sample__appointment",
            "order__technician",
            "biologist",
        )
        return Response(TestResultSerializer(results, many=True).data)
