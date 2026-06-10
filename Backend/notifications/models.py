"""Notifications transactionnelles.

Une `Notification` est un message *adressé à un utilisateur précis* et
créée par le système suite à un événement métier — changement de statut
d'un RDV, résultat validé, visite à domicile à effectuer, etc.

C'est volontairement très simple : pas de Redis/Channels, pas de push
Firebase. Le mobile poll `GET /notifications/mine/` (toutes les 30 s ou
au focus d'écran) et le compteur unread vient du même endpoint. Si plus
tard on veut ajouter du push, on branche un signal `post_save` sur
`Notification` qui envoie au broker.

Le champ `payload` (JSON) sert à transporter les références opaques —
`appointment_uuid`, `order_uuid`, etc. — pour que le client puisse
faire un `deep-link` vers l'écran concerné quand on tappe la notif.

Le champ `kind` est l'identifiant logique de l'événement, utilisé côté
UI pour choisir l'icône/couleur et côté backend pour dédupliquer si
besoin. La liste est ouverte : on ajoute un kind sans migration.
"""
from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils import timezone

from core.models import BaseModel


class NotificationKind(models.TextChoices):
    # Cycle de vie d'un RDV (patient + staff)
    APPT_CREATED      = "appt_created",      "RDV créé"
    APPT_CONFIRMED    = "appt_confirmed",    "RDV confirmé"
    APPT_CHECKED_IN   = "appt_checked_in",   "Patient arrivé"
    APPT_IN_PROGRESS  = "appt_in_progress",  "Visite démarrée"
    APPT_COMPLETED    = "appt_completed",    "Visite terminée"
    APPT_CANCELLED    = "appt_cancelled",    "RDV annulé"
    APPT_NURSE_ASSIGNED = "appt_nurse_assigned", "Infirmier·e affecté·e"

    # Workflow d'analyse (patient + staff)
    SAMPLE_RECEIVED   = "sample_received",   "Échantillon reçu"
    RESULT_ENTERED    = "result_entered",    "Résultat saisi"
    RESULT_VALIDATED  = "result_validated",  "Résultat validé"
    RESULT_AVAILABLE  = "result_available",  "Résultat disponible"
    SAMPLE_REJECTED   = "sample_rejected",   "Échantillon rejeté"

    # Divers
    INFO              = "info",              "Information"


class NotificationSeverity(models.TextChoices):
    """Échelle simple pour décider de la couleur/priorité côté UI.

    `success` → leaf (vert), `info` → brand (turquoise),
    `warning` → sun (jaune), `critical` → coral (rouge).
    """
    SUCCESS  = "success",  "Succès"
    INFO     = "info",     "Information"
    WARNING  = "warning",  "Attention"
    CRITICAL = "critical", "Critique"


class Notification(BaseModel):
    """Message transactionnel adressé à un utilisateur."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notifications",
        db_index=True,
    )
    kind = models.CharField(
        max_length=40, choices=NotificationKind.choices,
        default=NotificationKind.INFO,
    )
    severity = models.CharField(
        max_length=10, choices=NotificationSeverity.choices,
        default=NotificationSeverity.INFO,
    )
    title = models.CharField(max_length=160)
    body = models.TextField(blank=True)
    # Map opaque transportée jusqu'à l'UI — uuids d'objets liés (RDV,
    # ordre, sample…) que le client utilise pour deep-link. On évite
    # une FK générique pour ne pas couplet `notifications` à toutes les
    # apps métier — si l'objet référencé est supprimé, on garde la
    # notif comme un journal.
    payload = models.JSONField(default=dict, blank=True)

    read_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["user", "-created_at"]),
            models.Index(fields=["user", "read_at"]),
        ]

    def __str__(self) -> str:
        return f"[{self.kind}] {self.title} → user#{self.user_id}"

    def mark_read(self) -> None:
        if self.read_at is None:
            self.read_at = timezone.now()
            self.save(update_fields=["read_at", "updated_at"])
