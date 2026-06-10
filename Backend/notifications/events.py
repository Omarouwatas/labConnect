"""Helpers pour émettre des notifications depuis les apps métier.

Au lieu d'appeler `Notification.objects.create(...)` partout, on passe
par ces fonctions — elles encapsulent :
  - la résolution des destinataires (patient, infirmière assignée,
    staff du labo selon le besoin),
  - le titre/body en français formaté à partir des objets,
  - le `payload` standardisé pour les deep-links côté UI.

Ce module n'importe RIEN d'autre que `notifications.models` et les
modèles métier au runtime — on évite les imports circulaires en faisant
les imports lazy dans chaque helper.
"""
from __future__ import annotations

from typing import Iterable

from django.contrib.auth import get_user_model
from django.db.models import Q

from .models import Notification, NotificationKind, NotificationSeverity


User = get_user_model()


def _notify(user, *, kind, title, body="", severity=NotificationSeverity.INFO, payload=None):
    """Crée une notif pour un user donné. No-op si user est None."""
    if user is None:
        return None
    return Notification.objects.create(
        user=user,
        kind=kind,
        severity=severity,
        title=title,
        body=body,
        payload=payload or {},
    )


def _notify_many(users: Iterable, **kwargs):
    """Crée la même notif pour chaque user de la liste."""
    out = []
    seen = set()
    for u in users:
        if u is None or u.id in seen:
            continue
        seen.add(u.id)
        out.append(_notify(u, **kwargs))
    return [n for n in out if n is not None]


def _lab_staff(lab, role_names: Iterable[str]):
    """Retourne les users staff actifs du labo avec un des rôles donnés."""
    from accounts.models import StaffProfile
    if lab is None:
        return []
    qs = (
        StaffProfile.active
        .filter(laboratory=lab, user__is_active=True)
        .filter(user__groups__name__in=list(role_names))
        .select_related("user")
        .distinct()
    )
    return [sp.user for sp in qs]


# ── Cycle de vie d'un RDV ──────────────────────────────────────────────

def notify_appointment_created(appt):
    """Émise quand un RDV est posé (patient mobile ou walk-in)."""
    payload = {
        "appointment_uuid": str(appt.uuid),
        "laboratory_uuid": str(appt.laboratory.uuid),
    }
    _notify(
        appt.patient,
        kind=NotificationKind.APPT_CREATED,
        title="Rendez-vous enregistré",
        body=f"Votre RDV au {appt.laboratory.name} le "
             f"{appt.scheduled_for:%d/%m à %H:%M} a bien été enregistré.",
        severity=NotificationSeverity.INFO,
        payload=payload,
    )
    # Côté staff, la secrétaire suit les nouveaux RDV.
    _notify_many(
        _lab_staff(appt.laboratory, ["secretary", "lab_chief"]),
        kind=NotificationKind.APPT_CREATED,
        title=f"Nouveau RDV · {appt.patient.first_name or appt.patient.phone}",
        body=f"{appt.scheduled_for:%d/%m à %H:%M} — "
             f"{'visite à domicile' if appt.visit_type == 'home' else 'au laboratoire'}.",
        severity=NotificationSeverity.INFO,
        payload=payload,
    )


def notify_appointment_status_changed(appt, *, by_user=None):
    """Émise après `change_status` (toutes transitions courantes).

    On adapte le ton de la notif au statut atteint. Pour le patient on
    privilégie un message clair (sans jargon technique) ; pour le staff
    on privilégie des infos opérationnelles.
    """
    payload = {
        "appointment_uuid": str(appt.uuid),
        "laboratory_uuid": str(appt.laboratory.uuid),
        "status": appt.status,
    }
    s = appt.status
    lab_name = appt.laboratory.name

    if s == "confirmed":
        _notify(
            appt.patient,
            kind=NotificationKind.APPT_CONFIRMED,
            title="RDV confirmé",
            body=f"Votre rendez-vous au {lab_name} a été confirmé.",
            severity=NotificationSeverity.SUCCESS,
            payload=payload,
        )
    elif s == "checked_in":
        _notify(
            appt.patient,
            kind=NotificationKind.APPT_CHECKED_IN,
            title="Arrivée enregistrée",
            body=f"Bienvenue au {lab_name}. Nous nous occupons de vous.",
            severity=NotificationSeverity.INFO,
            payload=payload,
        )
    elif s == "in_progress":
        _notify(
            appt.patient,
            kind=NotificationKind.APPT_IN_PROGRESS,
            title="Prélèvement en cours",
            body=f"Votre prélèvement est en cours au {lab_name}.",
            severity=NotificationSeverity.INFO,
            payload=payload,
        )
    elif s == "completed":
        _notify(
            appt.patient,
            kind=NotificationKind.APPT_COMPLETED,
            title="Visite terminée",
            body="Vos résultats arrivent — vous serez prévenu·e dès validation.",
            severity=NotificationSeverity.SUCCESS,
            payload=payload,
        )
    elif s in ("cancelled", "no_show"):
        _notify(
            appt.patient,
            kind=NotificationKind.APPT_CANCELLED,
            title="RDV annulé" if s == "cancelled" else "Absence enregistrée",
            body=f"Votre rendez-vous au {lab_name} a été annulé.",
            severity=NotificationSeverity.WARNING,
            payload=payload,
        )


def notify_appointment_nurse_assigned(appt, *, nurse):
    """Émise par `assign-nurse` côté secrétaire."""
    if nurse is None:
        return
    payload = {
        "appointment_uuid": str(appt.uuid),
        "nurse_uuid": str(nurse.uuid),
    }
    _notify(
        nurse,
        kind=NotificationKind.APPT_NURSE_ASSIGNED,
        title="Nouvelle visite assignée",
        body=f"{appt.scheduled_for:%d/%m à %H:%M} · "
             f"{appt.patient.first_name or appt.patient.phone} "
             f"({appt.home_address or 'adresse non renseignée'}).",
        severity=NotificationSeverity.INFO,
        payload=payload,
    )
    # Le patient sait qu'un préleveur a été affecté.
    _notify(
        appt.patient,
        kind=NotificationKind.APPT_NURSE_ASSIGNED,
        title="Infirmier·e affecté·e",
        body="Une personne va passer chez vous au créneau prévu.",
        severity=NotificationSeverity.SUCCESS,
        payload=payload,
    )


# ── Workflow d'analyse ─────────────────────────────────────────────────

def notify_sample_received(sample, *, by_user=None):
    """Émise quand un sample passe en `received` (cascade RDV ou réception
    manuelle au comptoir)."""
    appt = sample.appointment
    payload = {
        "appointment_uuid": str(appt.uuid),
        "sample_uuid": str(sample.uuid),
    }
    _notify(
        appt.patient,
        kind=NotificationKind.SAMPLE_RECEIVED,
        title="Échantillon reçu au labo",
        body=f"Votre échantillon est arrivé. L'analyse commence.",
        severity=NotificationSeverity.INFO,
        payload=payload,
    )


def notify_result_entered(order, *, by_user=None):
    """Émise quand le technicien saisit un résultat (passe en `completed`).

    À ce stade, on prévient le biologiste (ou chef de labo) du labo
    qu'un résultat est à valider. Pas de notif patient — on attend la
    validation pour ne pas envoyer de résultat partiellement contrôlé.
    """
    payload = {
        "order_uuid": str(order.uuid),
        "appointment_uuid": str(order.sample.appointment.uuid),
        "test_code": order.test.code,
    }
    lab = order.sample.laboratory
    _notify_many(
        _lab_staff(lab, ["biologist", "lab_chief"]),
        kind=NotificationKind.RESULT_ENTERED,
        title=f"Résultat à valider · {order.test.code}",
        body=f"{order.sample.appointment.patient.first_name or order.sample.appointment.patient.phone} — "
             f"{order.test.name}",
        severity=NotificationSeverity.WARNING,
        payload=payload,
    )


def notify_result_validated(order, *, by_user=None):
    """Émise quand le biologiste valide un résultat → patient peut
    télécharger le PDF."""
    appt = order.sample.appointment
    payload = {
        "order_uuid": str(order.uuid),
        "appointment_uuid": str(appt.uuid),
        "test_code": order.test.code,
    }
    severity = NotificationSeverity.SUCCESS
    # Si le drapeau du résultat est critique, on remonte la sévérité.
    try:
        flag = order.result.flag
        if flag == "critical":
            severity = NotificationSeverity.CRITICAL
        elif flag == "high":
            severity = NotificationSeverity.WARNING
    except Exception:
        pass

    _notify(
        appt.patient,
        kind=NotificationKind.RESULT_AVAILABLE,
        title=f"Résultat disponible · {order.test.name}",
        body="Votre résultat est validé et disponible dans l'app — "
             "vous pouvez le télécharger en PDF.",
        severity=severity,
        payload=payload,
    )


def notify_sample_rejected(sample, *, reason="", by_user=None):
    appt = sample.appointment
    payload = {
        "sample_uuid": str(sample.uuid),
        "appointment_uuid": str(appt.uuid),
        "reason": reason,
    }
    _notify(
        appt.patient,
        kind=NotificationKind.SAMPLE_REJECTED,
        title="Échantillon non conforme",
        body=reason or "Votre échantillon a dû être écarté. "
                       "Le laboratoire vous recontactera.",
        severity=NotificationSeverity.CRITICAL,
        payload=payload,
    )
