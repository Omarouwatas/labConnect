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
    # Prefetch samples → orders → test pour que AppointmentSerializer.items
    # ne génère pas de N+1 lors d'une liste (la facette des prix est lue
    # depuis chaque TestOrder).
    queryset = Appointment.active.all().select_related(
        "laboratory", "patient", "assigned_nurse",
    ).prefetch_related(
        "samples__orders__test",
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
        appt = serializer.save()
        # Notif au patient + à la secrétaire du labo. On reste tolérant
        # aux erreurs : si l'envoi notif échoue (DB read-only en test,
        # etc.) on ne casse pas la création de RDV.
        try:
            from notifications.events import notify_appointment_created
            notify_appointment_created(appt)
        except Exception:
            pass

    @action(detail=False, methods=["get"], url_path="mine")
    def mine(self, request):
        """RDV du patient connecté (raccourci)."""
        qs = (
            Appointment.active
            .filter(patient=request.user)
            .select_related("laboratory", "assigned_nurse", "patient")
            .prefetch_related("samples__orders__test")
        )
        return Response(AppointmentSerializer(qs, many=True).data)

    @action(detail=False, methods=["get"], url_path="home-visits")
    def home_visits(self, request):
        """Visites à domicile — contextualisé selon le rôle.

        Query params :
          - scope=mine | all      (par défaut : `mine` si nurse seule,
                                   `all` si secretary/chef)
          - unassigned=1          (filtre uniquement celles sans nurse)
          - date=YYYY-MM-DD       (filtre par jour ; par défaut, on
                                   retourne tout le futur proche)
          - include_done=1        (inclut les visites completed)
        """
        if not _has_2fa(request):
            raise PermissionDenied("2FA requise.")

        roles = _user_roles(request.user)
        is_nurse = RoleNames.NURSE in roles
        is_manager = bool(roles.intersection(
            {RoleNames.SECRETARY, RoleNames.LAB_CHIEF, RoleNames.BIOLOGIST}
        ))
        if not (is_nurse or is_manager):
            raise PermissionDenied("Réservé aux infirmier·es et au staff de gestion.")

        # Scope : un manager voit tout par défaut, une nurse pure voit
        # ses propres visites. `scope` permet d'inverser explicitement.
        scope = request.query_params.get("scope")
        if scope not in ("mine", "all"):
            scope = "all" if is_manager else "mine"

        # Lab actif (les managers sont scopés à leur labo ; une nurse
        # n'a besoin que de ses RDV assignés, lab implicite).
        lab_id = current_lab_id(request) if is_manager else None

        qs = Appointment.active.filter(visit_type=VisitType.HOME).select_related(
            "laboratory", "patient", "assigned_nurse",
        ).prefetch_related(
            # AppointmentSerializer.items itère sur samples → orders → test
            # pour chaque RDV. Sans prefetch, c'est du N+1 lors de la liste
            # mobile/nurse — on hydrate ici comme dans le viewset principal.
            "samples__orders__test",
        )
        if lab_id is not None:
            qs = qs.filter(laboratory_id=lab_id)
        if scope == "mine":
            qs = qs.filter(assigned_nurse=request.user)

        if request.query_params.get("unassigned") == "1":
            qs = qs.filter(assigned_nurse__isnull=True)

        date = request.query_params.get("date")
        if date:
            qs = qs.filter(scheduled_for__date=date)

        include_done = request.query_params.get("include_done") == "1"
        allowed_status = [
            AppointmentStatus.PENDING,
            AppointmentStatus.CONFIRMED,
            AppointmentStatus.IN_PROGRESS,
        ]
        if include_done:
            allowed_status += [AppointmentStatus.COMPLETED]
        qs = qs.filter(status__in=allowed_status).order_by("scheduled_for")

        return Response(AppointmentSerializer(qs, many=True).data)

    @action(detail=True, methods=["patch"], url_path="assign-nurse")
    def assign_nurse(self, request, uuid=None):
        """Affecter une infirmière à un RDV à domicile.

        Raccourci dédié pour le sélecteur de l'écran « Tournées » :
          - body : `{ "nurse_uuid": "..." }` pour assigner
          - body : `{ "nurse_uuid": null }` pour désassigner
          - en bonus, on passe le statut de pending → confirmed à
            l'affectation (la visite est désormais planifiée).

        Réservé au secrétaire / chef de labo (2FA requise).
        """
        appt = self.get_object()
        roles = _user_roles(request.user)
        if not roles.intersection({RoleNames.SECRETARY, RoleNames.LAB_CHIEF}):
            raise PermissionDenied("Affectation réservée à la secrétaire / au chef.")
        if not _has_2fa(request):
            raise PermissionDenied("2FA requise.")
        if appt.visit_type != VisitType.HOME:
            raise ValidationError("Affectation réservée aux visites à domicile.")

        # `nurse_uuid` peut être null/absent → désaffectation.
        nurse_uuid = request.data.get("nurse_uuid")
        if nurse_uuid in (None, "", "null"):
            appt.assigned_nurse = None
        else:
            try:
                nurse = User.objects.get(
                    uuid=nurse_uuid, groups__name=RoleNames.NURSE,
                )
            except User.DoesNotExist as exc:
                raise ValidationError({"nurse_uuid": "Infirmier·e introuvable."}) from exc
            # Vérifie que l'infirmière travaille bien dans ce labo.
            from accounts.models import StaffProfile
            if not StaffProfile.active.filter(
                user=nurse, laboratory=appt.laboratory,
            ).exists():
                raise ValidationError(
                    {"nurse_uuid": "Cette infirmière n'est pas affectée à ce laboratoire."},
                )
            appt.assigned_nurse = nurse
            # Auto-confirm : si la visite était en attente, l'affectation
            # vaut planification.
            if appt.status == AppointmentStatus.PENDING:
                appt.status = AppointmentStatus.CONFIRMED

        appt.save(update_fields=["assigned_nurse", "status", "updated_at"])
        # Notifie la nouvelle infirmière + le patient. Si on a désaffecté
        # (nurse_uuid=null), pas de notif — c'est silencieux.
        try:
            from notifications.events import notify_appointment_nurse_assigned
            notify_appointment_nurse_assigned(appt, nurse=appt.assigned_nurse)
        except Exception:
            pass
        return Response(AppointmentSerializer(appt).data)

    @action(detail=True, methods=["patch"], url_path="tubes")
    def set_tubes(self, request, uuid=None):
        """Enregistre le code-barre du tube physique pour chaque test du RDV.

        Format attendu : ``{ "tubes": { "<order_uuid>": "<barcode>", … } }``

        Utilisé par l'app infirmier·e à la fin du prélèvement guidé :
        chaque ligne de l'étape « Étiqueter & prélever » a son input
        de code-barre (saisi manuellement ou scanné). On accepte un
        partiel (les ordres absents de la map sont laissés tels quels).

        Permission : staff du labo (l'infirmière elle-même peut le faire
        si elle est assignée au RDV — ce qui est le cas typique).
        """
        from analyses.models import TestOrder
        appt = self.get_object()
        roles = _user_roles(request.user)
        if not roles.intersection(RoleNames.ALL_STAFF):
            raise PermissionDenied("Staff uniquement.")
        if not _has_2fa(request):
            raise PermissionDenied("2FA requise.")

        tubes = request.data.get("tubes") or {}
        if not isinstance(tubes, dict):
            raise ValidationError({"tubes": "Doit être un objet { order_uuid: barcode }."})

        # Borne le batch et on filtre sur les ordres effectivement liés
        # au RDV pour qu'un utilisateur ne puisse pas écrire sur un ordre
        # arbitraire en devinant son uuid.
        order_uuids = list(tubes.keys())[:64]
        orders = list(
            TestOrder.active.filter(
                uuid__in=order_uuids,
                sample__appointment=appt,
            )
        )
        updated = 0
        for o in orders:
            barcode = (tubes.get(str(o.uuid)) or "").strip()[:64]
            if barcode != o.tube_barcode:
                o.tube_barcode = barcode
                o.save(update_fields=["tube_barcode", "updated_at"])
                updated += 1

        # Renvoie l'état complet du RDV (avec les items mis à jour) pour
        # que le client puisse synchroniser sans round-trip.
        return Response({
            "updated": updated,
            "appointment": AppointmentSerializer(appt).data,
        })

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
        """Avance le RDV dans son cycle de vie.

        Transitions courantes :
          pending → confirmed       (la secrétaire valide le créneau)
          confirmed → checked_in    (le patient arrive au labo)
          checked_in → in_progress  (prélèvement effectué)
          in_progress → completed   (RDV terminé)
          * → cancelled / no_show   (cas spéciaux)

        Cascade automatique sur le matériel d'analyse :
          - `in_progress` ou `checked_in` → réceptionne tous les samples
            encore pending/collected et bascule leurs orders en
            `in_progress`. Même chemin que `PATCH /lab/samples/{uuid}/
            receive/` mais déclenché côté RDV : la secrétaire n'a pas
            à faire deux clics quand le patient est en salle.
          - `completed` → ne touche pas aux orders : un RDV "terminé"
            côté planning n'implique pas que tous les résultats sont
            validés (le biologiste peut valider après coup).
          - `cancelled` / `no_show` → ne touche pas non plus : le labo
            reste libre de rejeter explicitement les samples avec motif.
        """
        from django.db import transaction
        from analyses.models import OrderStatus, SampleStatus, TestOrder

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

        cascade_receive = new_status in (
            AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_PROGRESS,
        )

        with transaction.atomic():
            appt.status = new_status
            appt.save()
            cascaded_samples = []
            if cascade_receive:
                now = timezone.now()
                # On filtre sur les samples encore réceptionnables — on ne
                # ré-écrit pas un sample déjà reçu ou rejeté.
                samples_qs = appt.samples.filter(
                    status__in=(SampleStatus.PENDING, SampleStatus.COLLECTED),
                )
                sample_ids = list(samples_qs.values_list("id", flat=True))
                if sample_ids:
                    samples_qs.update(
                        status=SampleStatus.RECEIVED,
                        received_at=now,
                        received_by=request.user,
                    )
                    # Les orders pending de ces samples → in_progress.
                    TestOrder.objects.filter(
                        sample_id__in=sample_ids, status=OrderStatus.PENDING,
                    ).update(
                        status=OrderStatus.IN_PROGRESS,
                        started_at=now,
                        technician=request.user,
                    )
                    cascaded_samples = list(
                        appt.samples.filter(id__in=sample_ids)
                    )

        # ── Notifs ────────────────────────────────────────────────────
        # On émet hors de la transaction pour ne pas la bloquer en cas
        # de soucis avec la table notifications. Tolérant aux erreurs.
        try:
            from notifications.events import (
                notify_appointment_status_changed,
                notify_sample_received,
            )
            notify_appointment_status_changed(appt, by_user=request.user)
            for sample in cascaded_samples:
                notify_sample_received(sample, by_user=request.user)
        except Exception:
            pass
        return Response(AppointmentSerializer(appt).data)
