from __future__ import annotations

from rest_framework import serializers

from core.permissions import RoleNames

from .models import Appointment, AppointmentStatus, VisitType


class AppointmentSerializer(serializers.ModelSerializer):
    """Lecture détaillée d'un RDV."""
    laboratory_uuid = serializers.UUIDField(source="laboratory.uuid", read_only=True)
    laboratory_name = serializers.CharField(source="laboratory.name", read_only=True)
    patient_uuid = serializers.UUIDField(source="patient.uuid", read_only=True)
    patient_phone = serializers.CharField(source="patient.phone", read_only=True)
    patient_name = serializers.SerializerMethodField()
    nurse_uuid = serializers.UUIDField(source="assigned_nurse.uuid", read_only=True, allow_null=True)
    nurse_name = serializers.SerializerMethodField()
    total_fee_mru = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    home_latitude = serializers.SerializerMethodField()
    home_longitude = serializers.SerializerMethodField()

    class Meta:
        model = Appointment
        fields = (
            "uuid",
            "laboratory_uuid", "laboratory_name",
            "patient_uuid", "patient_phone", "patient_name",
            "visit_type", "status",
            "scheduled_for", "duration_minutes",
            "home_address", "home_latitude", "home_longitude",
            "nurse_uuid", "nurse_name",
            "base_fee_mru", "surcharge_mru", "total_fee_mru",
            "notes",
            "created_at", "updated_at",
        )
        read_only_fields = fields

    def get_home_latitude(self, obj):
        return obj.home_location.y if obj.home_location else None

    def get_home_longitude(self, obj):
        return obj.home_location.x if obj.home_location else None

    def get_patient_name(self, obj):
        return f"{obj.patient.first_name} {obj.patient.last_name}".strip() or obj.patient.phone

    def get_nurse_name(self, obj):
        n = obj.assigned_nurse
        if not n:
            return None
        return f"{n.first_name} {n.last_name}".strip() or n.phone


class AppointmentCreateSerializer(serializers.ModelSerializer):
    """Création par patient OU secrétaire.

    - Si l'utilisateur est patient, `patient` est forcé à request.user.
    - Si l'utilisateur est secrétaire, `patient_phone` doit être fourni.
    """
    patient_phone = serializers.CharField(write_only=True, required=False)
    laboratory_uuid = serializers.UUIDField(write_only=True, required=False)

    class Meta:
        model = Appointment
        fields = (
            "laboratory",
            "laboratory_uuid",
            "visit_type",
            "scheduled_for",
            "duration_minutes",
            "home_address",
            "notes",
            "patient_phone",
        )
        extra_kwargs = {"laboratory": {"required": False, "write_only": True}}

    def validate(self, attrs):
        from accounts.models import User
        from laboratories.models import Laboratory
        request = self.context["request"]
        user = request.user

        is_patient = user.groups.filter(name=RoleNames.PATIENT).exists()
        is_staff = user.groups.filter(
            name__in=(RoleNames.SECRETARY, RoleNames.LAB_CHIEF, RoleNames.NURSE)
        ).exists()

        if not (is_patient or is_staff):
            raise serializers.ValidationError("Aucun rôle autorisé pour créer un RDV.")

        # Patient = self ; Staff = lookup phone
        if is_patient and not is_staff:
            attrs["_resolved_patient"] = user
        else:
            phone = attrs.pop("patient_phone", None)
            if not phone:
                raise serializers.ValidationError({"patient_phone": "Requis pour le staff."})
            try:
                phone = User.normalize_phone(phone)
            except ValueError as exc:
                raise serializers.ValidationError({"patient_phone": str(exc)}) from exc
            patient, _ = User.objects.get_or_create(
                phone=phone, defaults={"is_phone_verified": False}
            )
            # S'assurer que le patient a au moins le rôle patient
            from django.contrib.auth.models import Group
            grp, _ = Group.objects.get_or_create(name=RoleNames.PATIENT)
            patient.groups.add(grp)
            attrs["_resolved_patient"] = patient

        laboratory_uuid = attrs.pop("laboratory_uuid", None)
        if laboratory_uuid and "laboratory" not in attrs:
            try:
                attrs["laboratory"] = Laboratory.active.get(uuid=laboratory_uuid, is_active=True)
            except Laboratory.DoesNotExist as exc:
                raise serializers.ValidationError({"laboratory_uuid": "Laboratoire introuvable."}) from exc
        if "laboratory" not in attrs:
            raise serializers.ValidationError({"laboratory_uuid": "Laboratoire requis."})

        # Visit type fees
        lab = attrs["laboratory"]
        attrs["base_fee_mru"] = 0
        if attrs["visit_type"] == VisitType.HOME:
            if not lab.accepts_home_visits:
                raise serializers.ValidationError("Ce labo n'accepte pas les visites à domicile.")
            attrs["surcharge_mru"] = lab.home_visit_fee_mru
        elif attrs["visit_type"] == VisitType.EMERGENCY:
            if not lab.accepts_emergencies:
                raise serializers.ValidationError("Ce labo n'accepte pas les urgences.")
            attrs["surcharge_mru"] = lab.emergency_fee_mru
        else:
            attrs["surcharge_mru"] = 0
        return attrs

    def create(self, validated_data):
        patient = validated_data.pop("_resolved_patient")
        request = self.context["request"]
        return Appointment.objects.create(
            patient=patient,
            created_by=request.user,
            status=AppointmentStatus.PENDING,
            **validated_data,
        )


class AppointmentStatusSerializer(serializers.Serializer):
    """Transitions de statut."""
    status = serializers.ChoiceField(choices=AppointmentStatus.choices)
    nurse_uuid = serializers.UUIDField(required=False, allow_null=True)
