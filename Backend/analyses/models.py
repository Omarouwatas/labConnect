"""Catalogue d'analyses + échantillons + résultats.

Flow :
  Appointment ──► Sample (collecté par infirmier ou secrétaire)
                    └── TestOrder (1 par test commandé)
                          └── TestResult (1 par order, validé par biologiste)
"""
from __future__ import annotations

from django.core.validators import MinValueValidator
from django.db import models

from core.models import BaseModel


# ── Catalogue (par labo) ─────────────────────────────────────────────

class SampleType(models.TextChoices):
    BLOOD = "blood", "Sang"
    URINE = "urine", "Urine"
    STOOL = "stool", "Selles"
    SALIVA = "saliva", "Salive"
    SWAB = "swab", "Prélèvement"
    OTHER = "other", "Autre"


class TestCatalogEntry(BaseModel):
    """Test proposé par un labo : nom, code, prix."""
    laboratory = models.ForeignKey(
        "laboratories.Laboratory",
        on_delete=models.CASCADE,
        related_name="catalog_entries",
    )
    code = models.CharField(max_length=40, db_index=True,
                            help_text="Code interne du test (ex: NFS, GLY, TSH).")
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    sample_type = models.CharField(max_length=12, choices=SampleType.choices, default=SampleType.BLOOD)
    price_mru = models.DecimalField(
        max_digits=10, decimal_places=2,
        validators=[MinValueValidator(0)],
    )
    turnaround_hours = models.PositiveSmallIntegerField(default=24)
    requires_fasting = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        verbose_name = "test catalog entry"
        verbose_name_plural = "test catalog entries"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=["laboratory", "code"],
                name="uniq_lab_test_code",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]
        indexes = [models.Index(fields=["laboratory", "is_active"])]

    def __str__(self) -> str:
        return f"{self.code} — {self.name}"


# ── Échantillons & ordres ────────────────────────────────────────────

class SampleStatus(models.TextChoices):
    PENDING = "pending", "À collecter"
    COLLECTED = "collected", "Collecté"
    RECEIVED = "received", "Reçu au labo"
    REJECTED = "rejected", "Rejeté"


class Sample(BaseModel):
    """Un échantillon physique lié à un RDV."""
    appointment = models.ForeignKey(
        "appointments.Appointment",
        on_delete=models.PROTECT,
        related_name="samples",
    )
    laboratory = models.ForeignKey(
        "laboratories.Laboratory",
        on_delete=models.PROTECT,
        related_name="samples",
    )
    barcode = models.CharField(max_length=64, unique=True, db_index=True)
    sample_type = models.CharField(max_length=12, choices=SampleType.choices)
    status = models.CharField(max_length=12, choices=SampleStatus.choices,
                              default=SampleStatus.PENDING, db_index=True)

    collected_at = models.DateTimeField(null=True, blank=True)
    collected_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="samples_collected",
        help_text="Infirmier·e ou secrétaire ayant fait le prélèvement.",
    )
    received_at = models.DateTimeField(null=True, blank=True)
    received_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="samples_received",
        help_text="Technicien·ne ayant réceptionné l'échantillon.",
    )
    rejection_reason = models.CharField(max_length=255, blank=True)

    class Meta:
        verbose_name = "sample"
        verbose_name_plural = "samples"
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"Sample {self.barcode} ({self.sample_type})"


class OrderStatus(models.TextChoices):
    PENDING = "pending", "En attente"
    IN_PROGRESS = "in_progress", "En cours"
    COMPLETED = "completed", "Résultat saisi"
    VALIDATED = "validated", "Validé"
    REJECTED = "rejected", "Rejeté"


class TestOrder(BaseModel):
    """Une demande d'un test précis sur un échantillon."""
    sample = models.ForeignKey(Sample, on_delete=models.CASCADE, related_name="orders")
    test = models.ForeignKey(TestCatalogEntry, on_delete=models.PROTECT,
                             related_name="orders")
    status = models.CharField(
        max_length=12, choices=OrderStatus.choices,
        default=OrderStatus.PENDING, db_index=True,
    )
    price_mru = models.DecimalField(max_digits=10, decimal_places=2)
    technician = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="orders_handled",
    )
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "test order"
        verbose_name_plural = "test orders"
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["status"])]


class ResultFlag(models.TextChoices):
    NORMAL = "normal", "Normal"
    LOW = "low", "Bas"
    HIGH = "high", "Haut"
    CRITICAL = "critical", "Critique"


class TestResult(BaseModel):
    """Résultat saisi (technicien) puis validé (biologiste)."""
    order = models.OneToOneField(
        TestOrder, on_delete=models.CASCADE, related_name="result",
    )
    value = models.CharField(max_length=120, help_text="Valeur mesurée (texte/numérique).")
    unit = models.CharField(max_length=24, blank=True)
    reference_range = models.CharField(max_length=80, blank=True)
    flag = models.CharField(
        max_length=12, choices=ResultFlag.choices,
        default=ResultFlag.NORMAL,
    )
    technician_notes = models.TextField(blank=True)
    technician_signed_at = models.DateTimeField(auto_now_add=True)

    biologist = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="results_validated",
    )
    biologist_validated_at = models.DateTimeField(null=True, blank=True)
    biologist_comment = models.TextField(blank=True)

    class Meta:
        verbose_name = "test result"
        verbose_name_plural = "test results"
