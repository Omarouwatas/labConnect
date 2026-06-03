from __future__ import annotations

import secrets
from rest_framework import serializers

from .models import (
    OrderStatus,
    ResultFlag,
    Sample,
    SampleStatus,
    TestCatalogEntry,
    TestOrder,
    TestResult,
)


# ── Catalogue ────────────────────────────────────────────────────────

class TestCatalogSerializer(serializers.ModelSerializer):
    class Meta:
        model = TestCatalogEntry
        fields = (
            "uuid", "code", "name", "description",
            "sample_type", "price_mru", "turnaround_hours",
            "requires_fasting", "prerequisite_questions", "is_active",
        )
        read_only_fields = ("uuid",)

    def validate_prerequisite_questions(self, value):
        # Liste de chaînes (titres de questions). On nettoie : pas
        # d'entrée non-string, on trim, on jette les vides — éviter
        # qu'un copier-coller maladroit ne pollue le catalogue.
        if not isinstance(value, list):
            raise serializers.ValidationError("Doit être une liste de chaînes.")
        cleaned = [str(q).strip() for q in value if str(q).strip()]
        return cleaned


# ── Sample ───────────────────────────────────────────────────────────

class SampleSerializer(serializers.ModelSerializer):
    appointment_uuid = serializers.UUIDField(source="appointment.uuid", read_only=True)
    patient_phone = serializers.CharField(source="appointment.patient.phone", read_only=True)
    patient_name = serializers.SerializerMethodField()

    class Meta:
        model = Sample
        fields = (
            "uuid", "barcode", "sample_type", "status",
            "appointment_uuid", "patient_phone", "patient_name",
            "collected_at", "received_at", "rejection_reason",
            "created_at", "updated_at",
        )
        read_only_fields = fields

    def get_patient_name(self, obj):
        p = obj.appointment.patient
        return f"{p.first_name} {p.last_name}".strip() or p.phone


class SampleCreateSerializer(serializers.ModelSerializer):
    """Création par infirmier ou secrétaire à partir d'un appointment_uuid + tests."""
    appointment_uuid = serializers.UUIDField(write_only=True)
    test_uuids = serializers.ListField(
        child=serializers.UUIDField(), write_only=True, min_length=1
    )

    class Meta:
        model = Sample
        fields = ("appointment_uuid", "test_uuids", "sample_type")

    def validate(self, attrs):
        from appointments.models import Appointment
        request = self.context["request"]
        try:
            appt = Appointment.active.get(uuid=attrs["appointment_uuid"])
        except Appointment.DoesNotExist as exc:
            raise serializers.ValidationError({"appointment_uuid": "RDV introuvable."}) from exc

        # Le staff doit appartenir au labo du RDV (un staff peut avoir
        # plusieurs StaffProfile, un par labo).
        if not request.user.staff_profiles.filter(
            laboratory_id=appt.laboratory_id, deleted_at__isnull=True
        ).exists():
            raise serializers.ValidationError("RDV hors de votre labo.")

        tests = list(
            TestCatalogEntry.active.filter(
                uuid__in=attrs["test_uuids"], laboratory=appt.laboratory, is_active=True
            )
        )
        if len(tests) != len(set(attrs["test_uuids"])):
            raise serializers.ValidationError({"test_uuids": "Tests invalides."})

        attrs["_appointment"] = appt
        attrs["_tests"] = tests
        return attrs

    def create(self, validated_data):
        from django.db import transaction
        appt = validated_data.pop("_appointment")
        tests = validated_data.pop("_tests")
        validated_data.pop("appointment_uuid", None)
        validated_data.pop("test_uuids", None)

        with transaction.atomic():
            sample = Sample.objects.create(
                appointment=appt,
                laboratory=appt.laboratory,
                barcode=_make_barcode(),
                **validated_data,
            )
            for t in tests:
                TestOrder.objects.create(sample=sample, test=t, price_mru=t.price_mru)
        return sample


def _make_barcode() -> str:
    return "S" + secrets.token_hex(6).upper()


# ── TestOrder ────────────────────────────────────────────────────────

class TestOrderSerializer(serializers.ModelSerializer):
    test_code = serializers.CharField(source="test.code", read_only=True)
    test_name = serializers.CharField(source="test.name", read_only=True)
    sample_barcode = serializers.CharField(source="sample.barcode", read_only=True)
    appointment_uuid = serializers.UUIDField(source="sample.appointment.uuid", read_only=True)
    patient_name = serializers.SerializerMethodField()
    has_result = serializers.SerializerMethodField()

    class Meta:
        model = TestOrder
        fields = (
            "uuid", "status",
            "test_code", "test_name", "price_mru",
            "cnam_covered_mru", "patient_due_mru",
            "sample_barcode", "appointment_uuid", "patient_name",
            "started_at", "completed_at",
            "has_result",
            "prerequisite_answers", "prerequisite_questions_snapshot",
            "created_at",
        )
        read_only_fields = fields

    def get_patient_name(self, obj):
        p = obj.sample.appointment.patient
        return f"{p.first_name} {p.last_name}".strip() or p.phone

    def get_has_result(self, obj):
        return hasattr(obj, "result")


# ── TestResult ───────────────────────────────────────────────────────

class TestResultSerializer(serializers.ModelSerializer):
    technician_name = serializers.SerializerMethodField()
    biologist_name = serializers.SerializerMethodField()
    test_name = serializers.CharField(source="order.test.name", read_only=True)
    test_code = serializers.CharField(source="order.test.code", read_only=True)
    patient_phone = serializers.CharField(source="order.sample.appointment.patient.phone", read_only=True)

    class Meta:
        model = TestResult
        fields = (
            "uuid",
            "test_name", "test_code", "patient_phone",
            "value", "unit", "reference_range", "flag",
            "technician_notes", "technician_name", "technician_signed_at",
            "biologist_name", "biologist_validated_at", "biologist_comment",
            "original_value",
        )
        read_only_fields = ("uuid", "technician_signed_at",
                            "biologist_validated_at", "technician_name", "biologist_name",
                            "test_name", "test_code", "patient_phone",
                            "original_value")

    def get_technician_name(self, obj):
        t = obj.order.technician
        return f"{t.first_name} {t.last_name}".strip() or t.phone if t else None

    def get_biologist_name(self, obj):
        b = obj.biologist
        return f"{b.first_name} {b.last_name}".strip() or b.phone if b else None


class TestResultCreateSerializer(serializers.Serializer):
    """Saisie par le technicien (sur un order_uuid)."""
    value = serializers.CharField(max_length=120)
    unit = serializers.CharField(max_length=24, required=False, allow_blank=True)
    reference_range = serializers.CharField(max_length=80, required=False, allow_blank=True)
    flag = serializers.ChoiceField(choices=ResultFlag.choices, default=ResultFlag.NORMAL)
    technician_notes = serializers.CharField(required=False, allow_blank=True)


class TestResultValidateSerializer(serializers.Serializer):
    """Validation par le biologiste.

    Si le biologiste corrige la valeur saisie par le technicien (ex :
    relecture critique, recalibrage), il peut fournir un nouveau ``value``
    / ``unit`` / ``reference_range`` / ``flag``. Dans ce cas la valeur
    d'origine est archivée dans ``TestResult.original_value`` pour la
    traçabilité.
    """
    biologist_comment = serializers.CharField(required=False, allow_blank=True)
    value = serializers.CharField(max_length=120, required=False, allow_blank=True)
    unit = serializers.CharField(max_length=24, required=False, allow_blank=True)
    reference_range = serializers.CharField(max_length=80, required=False, allow_blank=True)
    flag = serializers.ChoiceField(choices=ResultFlag.choices, required=False)
