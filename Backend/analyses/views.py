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

from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Sum, F
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework import permissions, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import HasRole, IsStaffAnd2FA, RoleNames, current_lab_id

from .models import (
    OrderStatus,
    Sample,
    SampleStatus,
    SampleType,
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
    _make_barcode,
)


# ── Helpers ──────────────────────────────────────────────────────────

def _roles(user) -> set[str]:
    return set(user.groups.values_list("name", flat=True))

def _require_2fa(request):
    token = getattr(request, "auth", None)
    return bool(getattr(token, "payload", {}).get("totp_verified", False))


def _split_cnam(price_mru, coverage_pct: int) -> tuple[int, int]:
    """Split d'un prix en (couvert_CNAM, dû_patient) — entiers MRU.

    Arrondi à l'unité côté CNAM (floor), le reste pour le patient : sur
    un éventuel reste, on charge plutôt le patient que la sécu, pour ne
    jamais sur-facturer la CNAM à cause d'un arrondi.
    """
    p = int(price_mru)
    pct = max(0, min(100, int(coverage_pct or 0)))
    covered = (p * pct) // 100
    return covered, p - covered


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

        # PATCH → validation biologiste (avec correction optionnelle)
        if RoleNames.BIOLOGIST not in roles and RoleNames.LAB_CHIEF not in roles:
            raise PermissionDenied("Validation réservée au biologiste / chef de labo.")
        if not hasattr(order, "result"):
            raise ValidationError("Aucun résultat saisi à valider.")
        ser = TestResultValidateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        payload = ser.validated_data
        result = order.result
        update_fields = ["biologist", "biologist_validated_at", "biologist_comment", "updated_at"]

        # Détecte une correction effective (au moins un champ fourni qui
        # diffère de l'existant). On archive *une seule fois* la valeur
        # technicien d'origine — si le biologiste re-corrige une 2e fois,
        # `original_value` continue de pointer sur la 1re saisie.
        original_snapshot = f"{result.value} {result.unit} [{result.flag}]".strip()
        new_value = payload.get("value")
        new_unit = payload.get("unit")
        new_range = payload.get("reference_range")
        new_flag = payload.get("flag")
        edited = False
        if new_value is not None and new_value != result.value:
            edited = True
            result.value = new_value
            update_fields.append("value")
        if new_unit is not None and new_unit != result.unit:
            edited = True
            result.unit = new_unit
            update_fields.append("unit")
        if new_range is not None and new_range != result.reference_range:
            edited = True
            result.reference_range = new_range
            update_fields.append("reference_range")
        if new_flag is not None and new_flag != result.flag:
            edited = True
            result.flag = new_flag
            update_fields.append("flag")
        if edited and not result.original_value:
            result.original_value = original_snapshot[:160]
            update_fields.append("original_value")

        result.biologist = request.user
        result.biologist_validated_at = timezone.now()
        result.biologist_comment = payload.get("biologist_comment", "")
        result.save(update_fields=update_fields)
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


# ── Walk-in : staff crée une analyse pour un patient présent au labo ──

class WalkInSerializer(serializers.Serializer):
    """Saisie d'un patient au comptoir + tests choisis.

    `phone` est l'identifiant unique du patient (find-or-create). Si le
    patient n'existe pas encore en base, on le crée avec un PatientProfile
    et le rôle `patient` — il pourra ensuite télécharger l'app et lier
    son compte via son numéro.
    """
    phone = serializers.CharField(max_length=20)
    first_name = serializers.CharField(max_length=80, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=80, required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    # CNAM : si saisi au comptoir, on persiste sur le PatientProfile et on
    # applique le split au moment de créer chaque TestOrder. Les deux
    # champs sont optionnels et ne sont mis à jour que si fournis.
    cnam_number = serializers.CharField(max_length=32, required=False, allow_blank=True)
    cnam_coverage_pct = serializers.IntegerField(
        required=False, min_value=0, max_value=100, allow_null=True,
    )
    test_uuids = serializers.ListField(
        child=serializers.UUIDField(), min_length=1,
    )
    # Réponses au questionnaire pré-test, indexées par test_uuid →
    # liste de chaînes alignées sur prerequisite_questions du test.
    # Optionnel : un test sans questions n'a rien à recevoir, un test
    # avec questions mais sans réponse stocke des chaînes vides.
    prerequisite_answers = serializers.DictField(
        child=serializers.ListField(child=serializers.CharField(allow_blank=True)),
        required=False,
    )
    sample_type = serializers.ChoiceField(choices=SampleType.choices, required=False)
    notes = serializers.CharField(required=False, allow_blank=True)

    def validate_phone(self, value: str) -> str:
        from accounts.models import User
        try:
            return User.normalize_phone(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc


class WalkInView(APIView):
    """``POST /api/v1/lab/walk-in/``

    Permet à un·e secrétaire / infirmier·ère / chef de labo de créer une
    analyse pour un patient qui se présente au comptoir, **sans qu'il
    ait à utiliser l'app mobile**. La requête crée atomiquement :

      1. Le ``User`` patient (find-or-create par téléphone, hydrate les
         champs nom/email si fournis et vides en DB).
      2. Un ``Appointment`` ``visit_type=in_lab`` ``status=confirmed``
         programmé pour maintenant.
      3. Un ``Sample`` (type = `sample_type` fourni ou type du premier
         test) avec un barcode auto-généré.
      4. Un ``TestOrder`` par test sélectionné, prix figé.

    Côté permissions : tout staff 2FA dont le rôle est dans
    ``{secretary, nurse, lab_chief}``. Le biologiste/technicien ne sont
    pas autorisés à enregistrer de nouveaux patients pour éviter les
    erreurs de saisie.
    """
    permission_classes = (IsStaffAnd2FA,)

    @transaction.atomic
    def post(self, request):
        from accounts.models import PatientProfile, User
        from accounts.views import _assign_role
        from appointments.models import Appointment, AppointmentStatus, VisitType
        from laboratories.models import Laboratory

        roles = _roles(request.user)
        allowed = {
            RoleNames.SECRETARY, RoleNames.NURSE,
            RoleNames.TECHNICIAN, RoleNames.LAB_CHIEF,
        }
        if not roles.intersection(allowed):
            raise PermissionDenied(
                "Création de patient réservée au secrétaire / infirmier·e / technicien·ne / chef de labo.",
            )

        lab_id = current_lab_id(request)
        if not lab_id:
            raise ValidationError({"lab": "Aucun laboratoire actif (header X-Lab-Uuid)."})
        try:
            lab = Laboratory.active.get(pk=lab_id)
        except Laboratory.DoesNotExist as exc:
            raise ValidationError({"lab": "Laboratoire introuvable."}) from exc

        ser = WalkInSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        # Valide que tous les tests existent, sont actifs et appartiennent au labo courant
        wanted_uuids = list(dict.fromkeys(str(u) for u in data["test_uuids"]))
        tests = list(
            TestCatalogEntry.active.filter(
                uuid__in=wanted_uuids, laboratory=lab, is_active=True,
            )
        )
        if len(tests) != len(wanted_uuids):
            raise ValidationError({"test_uuids": "Un ou plusieurs tests sont invalides pour ce labo."})

        # Patient — find-or-create par téléphone
        patient, patient_created = User.objects.get_or_create(
            phone=data["phone"],
            defaults={"is_phone_verified": False},
        )
        update_fields: list[str] = []
        for field in ("first_name", "last_name", "email"):
            value = data.get(field) or ""
            if value and not getattr(patient, field, ""):
                setattr(patient, field, value)
                update_fields.append(field)
        if update_fields:
            patient.save(update_fields=[*update_fields, "updated_at"])

        if patient_created:
            profile = PatientProfile.objects.create(user=patient)
            _assign_role(patient, RoleNames.PATIENT)
        else:
            profile, _ = PatientProfile.objects.get_or_create(user=patient)
            if not patient.groups.filter(name=RoleNames.PATIENT).exists():
                _assign_role(patient, RoleNames.PATIENT)

        # CNAM : on met à jour le profil si l'agent a fourni de nouvelles
        # valeurs. Sinon on garde celles déjà en base — un patient connu
        # n'a pas à re-déclarer sa carte à chaque visite.
        profile_updates: list[str] = []
        cnam_number = (data.get("cnam_number") or "").strip()
        if cnam_number and cnam_number != profile.cnam_number:
            profile.cnam_number = cnam_number
            profile_updates.append("cnam_number")
        cnam_pct_in = data.get("cnam_coverage_pct")
        if cnam_pct_in is not None and int(cnam_pct_in) != profile.cnam_coverage_pct:
            profile.cnam_coverage_pct = int(cnam_pct_in)
            profile_updates.append("cnam_coverage_pct")
        if profile_updates:
            profile.save(update_fields=[*profile_updates, "updated_at"])

        coverage_pct = profile.cnam_coverage_pct or 0

        # RDV "in_lab" confirmé, programmé maintenant
        appt = Appointment.objects.create(
            patient=patient,
            laboratory=lab,
            visit_type=VisitType.IN_LAB,
            status=AppointmentStatus.CONFIRMED,
            scheduled_for=timezone.now(),
            notes=data.get("notes", ""),
            base_fee_mru=0,
            surcharge_mru=0,
            created_by=request.user,
        )

        # Échantillon
        sample_type = data.get("sample_type") or tests[0].sample_type
        sample = Sample.objects.create(
            appointment=appt,
            laboratory=lab,
            barcode=_make_barcode(),
            sample_type=sample_type,
        )

        # Un TestOrder par test — split CNAM/patient figé maintenant.
        # Le questionnaire pré-test est snapshotté côté ordre pour rester
        # cohérent avec les réponses données, même si le catalogue est
        # modifié plus tard.
        answers_by_test = data.get("prerequisite_answers") or {}
        for t in tests:
            covered, due = _split_cnam(t.price_mru, coverage_pct)
            qs = list(t.prerequisite_questions or [])
            raw_answers = answers_by_test.get(str(t.uuid)) or []
            # On normalise pour que la liste de réponses ait toujours la
            # même longueur que les questions (chaînes vides si manquant).
            answers = [str(raw_answers[i]) if i < len(raw_answers) else "" for i in range(len(qs))]
            TestOrder.objects.create(
                sample=sample, test=t, price_mru=t.price_mru,
                cnam_covered_mru=covered, patient_due_mru=due,
                prerequisite_questions_snapshot=qs,
                prerequisite_answers=answers,
            )

        total_mru = sum(int(t.price_mru) for t in tests)
        cnam_total = sum(_split_cnam(t.price_mru, coverage_pct)[0] for t in tests)
        patient_total = total_mru - int(cnam_total)
        return Response(
            {
                "appointment_uuid": str(appt.uuid),
                "patient_uuid": str(patient.uuid),
                "patient_phone": patient.phone,
                "patient_created": patient_created,
                "sample": SampleSerializer(sample).data,
                "tests_count": len(tests),
                "total_mru": total_mru,
                "cnam_coverage_pct": coverage_pct,
                "cnam_covered_total_mru": int(cnam_total),
                "patient_due_total_mru": patient_total,
            },
            status=status.HTTP_201_CREATED,
        )


# ── Statistiques ─────────────────────────────────────────────────────

class StatsView(APIView):
    """``GET /api/v1/lab/stats/?days=7``

    Tableau de bord agrégé pour le chef de labo / biologiste : KPI sur
    une fenêtre glissante (par défaut 7 jours), répartition par statut,
    par catégorie d'échantillon, par jour, et throughput par technicien.

    Permission : tout staff 2FA peut lire l'activité (counts, statuts),
    mais les agrégats financiers (revenue, CNAM) sont nuls pour qui n'a
    pas la permission ``viewFinance`` côté backend — on filtre dans la
    réponse, pas dans la requête (l'UI gate aussi côté React).
    """
    permission_classes = (IsStaffAnd2FA,)

    def get(self, request):
        lab_id = current_lab_id(request)
        if not lab_id:
            raise ValidationError({"lab": "Aucun laboratoire actif (header X-Lab-Uuid)."})
        try:
            days = max(1, min(90, int(request.query_params.get("days", 7))))
        except (TypeError, ValueError):
            days = 7
        since = timezone.now() - timedelta(days=days)

        # Base queryset : ordres du labo courant créés dans la fenêtre.
        base = (
            TestOrder.active
            .filter(sample__laboratory_id=lab_id, created_at__gte=since)
        )
        all_time = TestOrder.active.filter(sample__laboratory_id=lab_id)

        # KPI principaux. `revenue_mru` = somme des ordres validés
        # (ce qui a été *facturable* — pas forcément encaissé).
        kpi_totals = base.aggregate(
            total=Count("id"),
            completed=Count("id", filter=models_q(status="completed")),
            validated=Count("id", filter=models_q(status="validated")),
            rejected=Count("id", filter=models_q(status="rejected")),
            revenue=Sum("price_mru", filter=models_q(status="validated")),
            cnam_share=Sum("cnam_covered_mru", filter=models_q(status="validated")),
            patient_share=Sum("patient_due_mru", filter=models_q(status="validated")),
        )

        # Délai moyen technicien → biologiste (en heures) sur la fenêtre.
        # Approximation correcte : on prend completed_at − started_at sur
        # les ordres validés. Calcul côté Python pour rester portable.
        validated_qs = list(base.filter(
            status="validated",
            started_at__isnull=False,
            completed_at__isnull=False,
        ).values_list("started_at", "completed_at"))
        if validated_qs:
            total_seconds = sum((c - s).total_seconds() for s, c in validated_qs)
            avg_tat_hours = round((total_seconds / len(validated_qs)) / 3600.0, 1)
        else:
            avg_tat_hours = None

        # Répartition par statut — toujours sur la fenêtre.
        by_status = list(
            base.values("status").annotate(count=Count("id")).order_by("status")
        )

        # Répartition par catégorie d'échantillon (= sample_type du test).
        by_category = list(
            base.values(category=F("test__sample_type"))
            .annotate(
                count=Count("id"),
                revenue=Sum("price_mru", filter=models_q(status="validated")),
            )
            .order_by("-count")
        )

        # Activité par jour sur la fenêtre.
        by_day_rows = (
            base.annotate(day=TruncDate("created_at"))
            .values("day")
            .annotate(
                orders=Count("id"),
                validated=Count("id", filter=models_q(status="validated")),
            )
            .order_by("day")
        )
        by_day = [
            {
                "date": r["day"].isoformat() if r["day"] else None,
                "orders": r["orders"],
                "validated": r["validated"],
            }
            for r in by_day_rows
        ]

        # Throughput technicien / biologiste sur la fenêtre.
        by_technician_rows = (
            base.filter(technician__isnull=False, status__in=["completed", "validated"])
            .values("technician__uuid", "technician__first_name", "technician__last_name")
            .annotate(count=Count("id"))
            .order_by("-count")[:10]
        )
        by_technician = [
            {
                "uuid": str(r["technician__uuid"]),
                "name": f"{r['technician__first_name'] or ''} {r['technician__last_name'] or ''}".strip() or "—",
                "results_entered": r["count"],
            }
            for r in by_technician_rows
        ]

        # Niveau de stock — agrégat de l'app inventaire, optionnel.
        # Charge à la demande pour éviter d'imposer la dépendance si
        # l'app n'est pas encore installée dans INSTALLED_APPS.
        low_stock_items = []
        try:
            from inventory.models import InventoryItem
            low_stock_items = list(
                InventoryItem.active
                .filter(laboratory_id=lab_id)
                .annotate(current=F("current_stock"))
                .filter(min_stock__gt=0, current_stock__lte=F("min_stock"))
                .values("uuid", "name", "current_stock", "min_stock", "unit")[:20]
            )
            low_stock_items = [
                {**r, "uuid": str(r["uuid"])} for r in low_stock_items
            ]
        except Exception:
            pass

        # Filtre permissions : sans viewFinance, on remonte les KPI
        # d'activité mais on nullifie les agrégats financiers.
        roles = _roles(request.user)
        can_see_finance = bool(
            roles.intersection({RoleNames.BIOLOGIST, RoleNames.LAB_CHIEF})
        )
        revenue = int(kpi_totals["revenue"] or 0) if can_see_finance else None
        cnam_share = int(kpi_totals["cnam_share"] or 0) if can_see_finance else None
        patient_share = int(kpi_totals["patient_share"] or 0) if can_see_finance else None

        return Response({
            "period_days": days,
            "since": since,
            "kpis": {
                "total_orders": kpi_totals["total"] or 0,
                "completed_orders": kpi_totals["completed"] or 0,
                "validated_orders": kpi_totals["validated"] or 0,
                "rejected_orders": kpi_totals["rejected"] or 0,
                "revenue_mru": revenue,
                "cnam_share_mru": cnam_share,
                "patient_share_mru": patient_share,
                "avg_tat_hours": avg_tat_hours,
                "all_time_total": all_time.count(),
            },
            "by_status": by_status,
            "by_category": [
                {"category": r["category"], "count": r["count"],
                 "revenue_mru": int(r["revenue"] or 0) if can_see_finance else None}
                for r in by_category
            ],
            "by_day": by_day,
            "by_technician": by_technician,
            "low_stock_items": low_stock_items,
        })


def models_q(**kwargs):
    """Raccourci local pour des `filter=Q(...)` sur aggregate."""
    from django.db.models import Q
    return Q(**kwargs)


# ── Facturation ──────────────────────────────────────────────────────

class InvoiceView(APIView):
    """``GET /api/v1/lab/invoices/<appointment_uuid>/``

    Renvoie la facture détaillée d'un rendez-vous : informations patient
    (avec CNAM), labo, lignes par test (prix, part CNAM, part patient,
    statut), totaux. Accessible à tout staff du labo (lecture seule) —
    le détail financier reste protégé par 2FA via ``IsStaffAnd2FA``.
    """
    permission_classes = (IsStaffAnd2FA,)

    def get(self, request, appointment_uuid):
        from appointments.models import Appointment

        lab_id = current_lab_id(request)
        if not lab_id:
            raise ValidationError({"lab": "Aucun laboratoire actif (header X-Lab-Uuid)."})
        try:
            appt = Appointment.active.select_related(
                "patient", "patient__patient_profile", "laboratory",
            ).get(uuid=appointment_uuid, laboratory_id=lab_id)
        except Appointment.DoesNotExist as exc:
            raise ValidationError({"appointment_uuid": "RDV introuvable."}) from exc

        orders = (
            TestOrder.active
            .filter(sample__appointment=appt)
            .select_related("test", "sample")
            .order_by("created_at")
        )

        items = []
        subtotal = 0
        cnam_total = 0
        patient_total = 0
        for o in orders:
            items.append({
                "order_uuid": str(o.uuid),
                "test_code": o.test.code,
                "test_name": o.test.name,
                "sample_barcode": o.sample.barcode,
                "price_mru": int(o.price_mru),
                "cnam_covered_mru": int(o.cnam_covered_mru),
                "patient_due_mru": int(o.patient_due_mru),
                "status": o.status,
            })
            subtotal += int(o.price_mru)
            cnam_total += int(o.cnam_covered_mru)
            patient_total += int(o.patient_due_mru)

        # Si les anciens ordres ont été créés avant la migration CNAM,
        # leurs colonnes covered/due valent 0 — auquel cas on retombe sur
        # le prix complet à la charge du patient pour ne pas afficher 0
        # comme dû.
        if subtotal > 0 and (cnam_total + patient_total) == 0:
            patient_total = subtotal

        appt_fees = int(appt.base_fee_mru) + int(appt.surcharge_mru)
        patient = appt.patient
        profile = getattr(patient, "patient_profile", None)
        return Response({
            "appointment_uuid": str(appt.uuid),
            "scheduled_for": appt.scheduled_for,
            "visit_type": appt.visit_type,
            "patient": {
                "uuid": str(patient.uuid),
                "phone": patient.phone,
                "name": f"{patient.first_name} {patient.last_name}".strip() or patient.phone,
                "cnam_number": getattr(profile, "cnam_number", "") or "",
                "cnam_coverage_pct": getattr(profile, "cnam_coverage_pct", 0) or 0,
            },
            "laboratory": {
                "uuid": str(appt.laboratory.uuid),
                "name": appt.laboratory.name,
            },
            "items": items,
            "appointment_fees_mru": appt_fees,
            "subtotal_mru": subtotal,
            "cnam_covered_total_mru": cnam_total,
            "patient_due_total_mru": patient_total + appt_fees,
            "issued_at": timezone.now(),
        })
