"""Laboratory models."""
from __future__ import annotations

from django.contrib.gis.db import models as gis_models
from django.core.validators import MinValueValidator
from django.db import models
from django.utils.translation import gettext_lazy as _

from core.models import BaseModel

# Opening hours JSON structure:
# {
#   "mon": {"open": "08:00", "close": "18:00", "closed": false},
#   "tue": {"open": "08:00", "close": "18:00", "closed": false},
#   ...
#   "sun": {"closed": true}
# }
def default_opening_hours() -> dict:
    return {
        **{day: {"open": "08:00", "close": "18:00", "closed": False}
           for day in ("mon", "tue", "wed", "thu", "fri")},
        "sat": {"open": "08:00", "close": "13:00", "closed": False},
        "sun": {"closed": True},
    }


class Laboratory(BaseModel):
    """A medical laboratory participating in LabConnect."""

    class TechnicianMode(models.TextChoices):
        SEPARATE = "separate", _("Technicien distinct du biologiste")
        MERGED = "merged_with_biologist", _("Technicien fusionné avec le biologiste")

    # ── Identity ─────────────────────────────────────────────────────────
    name = models.CharField(max_length=150)
    slug = models.SlugField(max_length=160, unique=True)
    address = models.CharField(max_length=255)
    location = gis_models.PointField(geography=True, db_index=True)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    logo = models.ImageField(upload_to="lab_logos/", null=True, blank=True)
    description = models.TextField(blank=True)

    # ── Schedule ──────────────────────────────────────────────────────────
    opening_hours = models.JSONField(
        default=default_opening_hours,
        help_text=_(
            'Horaires par jour. Ex: {"mon": {"open": "08:00", "close": "18:00", "closed": false}}'
        ),
    )

    # ── Feature flags ─────────────────────────────────────────────────────
    accepts_home_visits = models.BooleanField(default=False)
    accepts_emergencies = models.BooleanField(default=False)
    technician_mode = models.CharField(
        max_length=32,
        choices=TechnicianMode.choices,
        default=TechnicianMode.SEPARATE,
        help_text=_(
            "Certains labos n'ont pas de technicien dédié : le biologiste saisit "
            "lui-même les valeurs. Configurable par labo."
        ),
    )

    # ── Fees (set by lab chief) ───────────────────────────────────────────
    home_visit_fee_mru = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        validators=[MinValueValidator(0)],
        help_text=_("Frais supplémentaires pour un prélèvement à domicile (MRU)."),
    )
    emergency_fee_mru = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        validators=[MinValueValidator(0)],
        help_text=_("Frais supplémentaires pour une prise en charge urgente (MRU)."),
    )

    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        verbose_name = _("laboratory")
        verbose_name_plural = _("laboratories")
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name
