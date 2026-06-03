from __future__ import annotations

from rest_framework import serializers

from .models import InventoryItem, InventoryMovement, ItemCategory, MovementReason


class InventoryItemSerializer(serializers.ModelSerializer):
    is_low_stock = serializers.BooleanField(read_only=True)

    class Meta:
        model = InventoryItem
        fields = (
            "uuid", "name", "code", "category", "unit",
            "current_stock", "min_stock", "unit_cost_mru",
            "supplier", "notes",
            "is_low_stock", "created_at", "updated_at",
        )
        read_only_fields = ("uuid", "current_stock", "is_low_stock",
                            "created_at", "updated_at")


class InventoryItemCreateSerializer(serializers.ModelSerializer):
    """Création d'un item : on accepte un stock initial qui sera reflété
    par un mouvement de type `delivery` dans la même transaction."""
    initial_stock = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, default=0,
        min_value=0,
    )

    class Meta:
        model = InventoryItem
        fields = (
            "name", "code", "category", "unit",
            "min_stock", "unit_cost_mru", "supplier", "notes",
            "initial_stock",
        )


class InventoryMovementSerializer(serializers.ModelSerializer):
    by_name = serializers.SerializerMethodField()

    class Meta:
        model = InventoryMovement
        fields = (
            "uuid", "delta", "reason", "notes",
            "by_name", "created_at",
        )
        read_only_fields = fields

    def get_by_name(self, obj):
        u = obj.created_by
        if not u:
            return None
        return f"{u.first_name} {u.last_name}".strip() or u.phone or u.email


class InventoryMovementCreateSerializer(serializers.Serializer):
    """Saisie d'un mouvement (livraison, consommation, ajustement)."""
    delta = serializers.DecimalField(max_digits=12, decimal_places=2)
    reason = serializers.ChoiceField(choices=MovementReason.choices)
    notes = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        # Garde-fou : une livraison ne devrait pas être négative, une
        # consommation pas positive. L'ajustement / la péremption
        # acceptent les deux signes (correction d'inventaire).
        reason = attrs["reason"]
        delta = attrs["delta"]
        if reason == MovementReason.DELIVERY and delta < 0:
            raise serializers.ValidationError(
                {"delta": "Une livraison doit être positive."},
            )
        if reason == MovementReason.CONSUMPTION and delta > 0:
            raise serializers.ValidationError(
                {"delta": "Une consommation doit être négative."},
            )
        if delta == 0:
            raise serializers.ValidationError({"delta": "Le delta ne peut pas être nul."})
        return attrs
