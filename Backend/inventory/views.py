"""Endpoints d'inventaire.

  GET    /api/v1/lab/inventory/                  — liste items
  POST   /api/v1/lab/inventory/                  — créer un item (+ stock initial)
  PATCH  /api/v1/lab/inventory/{uuid}/           — modifier un item
  DELETE /api/v1/lab/inventory/{uuid}/           — soft delete
  POST   /api/v1/lab/inventory/{uuid}/movement/  — enregistrer livraison / conso / ajustement
  GET    /api/v1/lab/inventory/{uuid}/movements/ — historique d'un item

Permissions : tout staff 2FA peut lire ; édition (POST/PATCH/DELETE) et
mouvements réservés au chef de labo et au technicien (les techniciens
saisissent les consommations à la paillasse).
"""
from __future__ import annotations

from django.db import transaction
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from core.permissions import IsStaffAnd2FA, RoleNames, current_lab_id

from .models import InventoryItem, InventoryMovement, MovementReason
from .serializers import (
    InventoryItemCreateSerializer,
    InventoryItemSerializer,
    InventoryMovementCreateSerializer,
    InventoryMovementSerializer,
)


def _roles(user) -> set[str]:
    return set(user.groups.values_list("name", flat=True))


def _can_edit(user) -> bool:
    return bool(_roles(user).intersection(
        {RoleNames.LAB_CHIEF, RoleNames.TECHNICIAN, RoleNames.BIOLOGIST},
    ))


class InventoryItemViewSet(viewsets.ModelViewSet):
    """CRUD items + actions movement / movements."""
    queryset = InventoryItem.active.all()
    lookup_field = "uuid"
    permission_classes = (IsStaffAnd2FA,)

    def get_serializer_class(self):
        if self.action == "create":
            return InventoryItemCreateSerializer
        return InventoryItemSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        lab_id = current_lab_id(self.request)
        if not lab_id:
            return qs.none()
        qs = qs.filter(laboratory_id=lab_id)
        params = self.request.query_params
        if "category" in params:
            qs = qs.filter(category=params["category"])
        if params.get("low_stock") in ("1", "true", "yes"):
            from django.db.models import F, Q
            qs = qs.filter(Q(min_stock__gt=0) & Q(current_stock__lte=F("min_stock")))
        return qs

    def create(self, request, *args, **kwargs):
        if not _can_edit(request.user):
            raise PermissionDenied("Création d'item réservée au chef / technicien / biologiste.")
        lab_id = current_lab_id(request)
        if not lab_id:
            raise ValidationError({"lab": "Aucun laboratoire actif (header X-Lab-Uuid)."})
        ser = InventoryItemCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        initial = data.pop("initial_stock", 0) or 0
        with transaction.atomic():
            item = InventoryItem.objects.create(
                laboratory_id=lab_id,
                current_stock=0,
                **data,
            )
            if initial and initial > 0:
                InventoryMovement.apply(
                    item=item, delta=initial,
                    reason=MovementReason.DELIVERY,
                    notes="Stock initial",
                    user=request.user,
                )
                item.refresh_from_db()
        return Response(InventoryItemSerializer(item).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        if not _can_edit(request.user):
            raise PermissionDenied("Modification d'item réservée au chef / technicien / biologiste.")
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        if not _can_edit(request.user):
            raise PermissionDenied("Modification d'item réservée au chef / technicien / biologiste.")
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if RoleNames.LAB_CHIEF not in _roles(request.user):
            raise PermissionDenied("Suppression d'item réservée au chef de labo.")
        obj = self.get_object()
        obj.soft_delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="movement")
    def movement(self, request, uuid=None):
        """Enregistre un mouvement de stock — livraison / consommation /
        ajustement / péremption. Met à jour le stock atomiquement."""
        if not _can_edit(request.user):
            raise PermissionDenied("Mouvement de stock réservé au chef / technicien / biologiste.")
        item = self.get_object()
        ser = InventoryMovementCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        try:
            mv = InventoryMovement.apply(
                item=item,
                delta=data["delta"],
                reason=data["reason"],
                notes=data.get("notes", ""),
                user=request.user,
            )
        except ValueError as exc:
            raise ValidationError({"delta": str(exc)}) from exc
        item.refresh_from_db()
        return Response(
            {
                "movement": InventoryMovementSerializer(mv).data,
                "item": InventoryItemSerializer(item).data,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["get"], url_path="movements")
    def movements(self, request, uuid=None):
        item = self.get_object()
        qs = item.movements.all().select_related("created_by").order_by("-created_at")[:200]
        return Response(InventoryMovementSerializer(qs, many=True).data)
