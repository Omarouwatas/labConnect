"""Appointments — patient prend RDV ou la secrétaire le crée pour lui.

Visit types :
  - in_lab          : RDV au laboratoire (créneau)
  - home            : visite à domicile (infirmier se déplace)
  - emergency       : urgence (frais supplémentaires)

Lifecycle :
  pending → confirmed → checked_in → in_progress → completed
                              ↘ cancelled (à n'importe quel moment)
                              ↘ no_show
"""
from __future__ import annotations

from django.contrib.gis.db.models import PointField
from django.core.validators import MinValueValidator
from django.db import models

from core.models import BaseModel


class VisitType(models.TextChoices):
    IN_LAB = "in_lab", "Au laboratoire"
    HOME = "home", "À domicile"
    EMERGENCY = "emergency", "Urgence"


class AppointmentStatus(models.TextChoices):
    PENDING = "pending", "En attente"
    CONFIRMED = "confirmed", "Confirmé"
    CHECKED_IN = "checked_in", "Patient arrivé"
    IN_PROGRESS = "in_progress", "En cours"
    COMPLETED = "completed", "Terminé"
    CANCELLED = "cancelled", "Annulé"
    NO_SHOW = "no_show", "Absent"


class Appointment(BaseModel):
    """Un RDV pour un patient dans un labo donné."""

    laboratory = models.ForeignKey(
        "laboratories.Laboratory",
        on_delete=models.PROTECT,
        related_name="appointments",
    )
    patient = models.ForeignKey(
        "accounts.User",
        on_delete=models.PROTECT,
        related_name="appointments",
    )

    visit_type = models.CharField(
        max_length=20, choices=VisitType.choices, default=VisitType.IN_LAB
    )
    status = models.CharField(
        max_length=20, choices=AppointmentStatus.choices,
        default=AppointmentStatus.PENDING, db_index=True,
    )

    scheduled_for = models.DateTimeField(db_index=True)
    duration_minutes = models.PositiveSmallIntegerField(default=30)

    # Pour les visites à domicile
    home_address = models.CharField(max_length=255, blank=True)
    home_location = PointField(geography=True, srid=4326, null=True, blank=True)
    assigned_nurse = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="home_visits",
        help_text="Infirmier·e affecté·e à la visite à domicile.",
    )

    # Tarifs (figés au moment de la création)
    base_fee_mru = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        validators=[MinValueValidator(0)],
    )
    surcharge_mru = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        help_text="Frais visite domicile / urgence",
        validators=[MinValueValidator(0)],
    )

    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="appointments_created",
    )

    class Meta:
        verbose_name = "appointment"
        verbose_name_plural = "appointments"
        ordering = ("-scheduled_for",)
        indexes = [
            models.Index(fields=["laboratory", "scheduled_for"]),
            models.Index(fields=["patient", "scheduled_for"]),
            models.Index(fields=["assigned_nurse", "scheduled_for"]),
        ]

    def __str__(self) -> str:
        return f"RDV {self.uuid} — {self.patient_id} @ {self.scheduled_for:%Y-%m-%d %H:%M}"

    @property
    def total_fee_mru(self):
        return self.base_fee_mru + self.surcharge_mru
