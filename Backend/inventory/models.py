"""Gestion d'inventaire — réactifs, consommables, équipements consommables.

Un `InventoryItem` est un article suivi (par labo). Son `current_stock`
est mis à jour transactionnellement par des `InventoryMovement` :
livraison (+), consommation (−), correction d'inventaire (±).

On garde l'historique des mouvements pour traçabilité (qui, quand,
combien, pourquoi) — un stock qui dérive sans trace n'est pas auditable.
"""
from __future__ import annotations

from django.core.validators import MinValueValidator
from django.db import models, transaction

from core.models import BaseModel


class ItemCategory(models.TextChoices):
    REAGENT = "reagent", "Réactif"
    CONSUMABLE = "consumable", "Consommable"
    EQUIPMENT = "equipment", "Équipement"
    OTHER = "other", "Autre"


class InventoryItem(BaseModel):
    """Article suivi en inventaire pour un labo."""
    laboratory = models.ForeignKey(
        "laboratories.Laboratory",
        on_delete=models.CASCADE,
        related_name="inventory_items",
    )
    name = models.CharField(max_length=160, db_index=True)
    code = models.CharField(max_length=40, blank=True, db_index=True,
                            help_text="Référence interne / SKU (facultatif).")
    category = models.CharField(
        max_length=12, choices=ItemCategory.choices, default=ItemCategory.REAGENT,
        db_index=True,
    )
    unit = models.CharField(max_length=24, default="unité",
                            help_text='Ex : "boîte de 100", "mL", "tube", "kit".')
    current_stock = models.DecimalField(
        max_digits=12, decimal_places=2, default=0,
        validators=[MinValueValidator(0)],
    )
    min_stock = models.DecimalField(
        max_digits=12, decimal_places=2, default=0,
        help_text="Seuil d'alerte. 0 = pas d'alerte.",
        validators=[MinValueValidator(0)],
    )
    unit_cost_mru = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        help_text="Coût unitaire d'achat (informatif, pour valoriser le stock).",
        validators=[MinValueValidator(0)],
    )
    supplier = models.CharField(max_length=160, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        verbose_name = "inventory item"
        verbose_name_plural = "inventory items"
        ordering = ("name",)
        indexes = [
            models.Index(fields=["laboratory", "category"]),
        ]

    def __str__(self) -> str:
        return f"{self.name} [{self.current_stock} {self.unit}]"

    @property
    def is_low_stock(self) -> bool:
        return self.min_stock > 0 and self.current_stock <= self.min_stock


class MovementReason(models.TextChoices):
    DELIVERY = "delivery", "Livraison"
    CONSUMPTION = "consumption", "Consommation"
    ADJUSTMENT = "adjustment", "Ajustement d'inventaire"
    EXPIRY = "expiry", "Péremption / casse"


class InventoryMovement(BaseModel):
    """Trace d'un changement de stock — `delta` signé.

    Positive = entrée (livraison, ajustement positif).
    Négative = sortie (consommation, ajustement négatif, péremption).
    Le `current_stock` de l'item est mis à jour atomiquement par la
    méthode de classe ``apply()`` (jamais en direct, jamais via ORM raw).
    """
    item = models.ForeignKey(
        InventoryItem, on_delete=models.CASCADE, related_name="movements",
    )
    delta = models.DecimalField(max_digits=12, decimal_places=2)
    reason = models.CharField(max_length=16, choices=MovementReason.choices)
    notes = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="inventory_movements",
    )

    class Meta:
        verbose_name = "inventory movement"
        verbose_name_plural = "inventory movements"
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["item", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.item_id}: {self.delta} ({self.reason})"

    @classmethod
    def apply(cls, *, item: "InventoryItem", delta, reason: str,
              notes: str = "", user=None) -> "InventoryMovement":
        """Crée le mouvement ET met à jour le stock dans la même transaction.

        Refuse une consommation qui ferait passer le stock en négatif —
        une dérive de stock indique souvent une erreur de saisie, pas un
        cas normal. Le chef peut toujours utiliser ``ADJUSTMENT`` négatif
        explicite pour aligner le stock physique sur l'inventaire compté.
        """
        from decimal import Decimal
        delta = Decimal(str(delta))
        with transaction.atomic():
            # SELECT FOR UPDATE pour éviter les data races si 2 agents
            # mouvementent le même item en parallèle.
            locked = InventoryItem.active.select_for_update().get(pk=item.pk)
            new_stock = locked.current_stock + delta
            if new_stock < 0:
                raise ValueError(
                    f"Stock insuffisant : {locked.current_stock} {locked.unit} disponibles, "
                    f"impossible de retirer {-delta}.",
                )
            locked.current_stock = new_stock
            locked.save(update_fields=["current_stock", "updated_at"])
            return cls.objects.create(
                item=locked, delta=delta, reason=reason,
                notes=notes, created_by=user,
            )
