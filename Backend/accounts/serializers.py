"""Auth serializers — OTP request/verify, login, refresh."""
from __future__ import annotations

from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from .models import User


class OTPRequestSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=20)
    purpose = serializers.ChoiceField(
        choices=["login", "register", "password_reset", "verify_phone"],
        default="login",
    )
    language = serializers.ChoiceField(choices=["fr", "ar"], default="fr")

    def validate_phone(self, value: str) -> str:
        try:
            return User.normalize_phone(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc


class OTPVerifySerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=20)
    code = serializers.CharField(min_length=6, max_length=6)
    purpose = serializers.ChoiceField(
        choices=["login", "register", "password_reset", "verify_phone"],
        default="login",
    )

    def validate_phone(self, value: str) -> str:
        try:
            return User.normalize_phone(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc


class UserMeSerializer(serializers.ModelSerializer):
    """Sérialiseur unifié User + PatientProfile.

    Le frontend mobile ne gère qu'un seul écran « Profil » qui doit lire
    et écrire à la fois les champs du `User` (nom, email, langue) et ceux
    du `PatientProfile` (CNAM, adresse, géoloc, blood, date_of_birth,
    gender). On expose donc les champs du profil patient à plat — quand
    le serializer reçoit un PATCH, on dispatche vers le bon modèle.

    Le `default_location` est exposé en lat/lng pour rester compatible
    avec une carte mobile basée sur expo-location (PointField est
    interne au stockage Django/PostGIS).
    """
    roles = serializers.SerializerMethodField()

    # PatientProfile (à plat) — tous nullable/optionnels.
    cnam_number = serializers.CharField(
        source="patient_profile.cnam_number",
        required=False, allow_blank=True, default="",
    )
    cnam_coverage_pct = serializers.IntegerField(
        source="patient_profile.cnam_coverage_pct",
        required=False, min_value=0, max_value=100,
    )
    date_of_birth = serializers.DateField(
        source="patient_profile.date_of_birth",
        required=False, allow_null=True,
    )
    gender = serializers.CharField(
        source="patient_profile.gender",
        required=False, allow_blank=True,
    )
    blood_type = serializers.CharField(
        source="patient_profile.blood_type",
        required=False, allow_blank=True,
    )
    emergency_contact = serializers.CharField(
        source="patient_profile.emergency_contact",
        required=False, allow_blank=True,
    )
    default_address = serializers.CharField(
        source="patient_profile.default_address",
        required=False, allow_blank=True,
    )
    default_latitude = serializers.SerializerMethodField()
    default_longitude = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            # User
            "uuid", "phone", "email",
            "first_name", "last_name", "preferred_language",
            "is_phone_verified", "roles",
            # PatientProfile (à plat)
            "cnam_number", "cnam_coverage_pct",
            "date_of_birth", "gender", "blood_type",
            "emergency_contact", "default_address",
            "default_latitude", "default_longitude",
        )
        read_only_fields = ("uuid", "phone", "is_phone_verified", "roles")

    def get_roles(self, obj: User) -> list[str]:
        return list(obj.groups.values_list("name", flat=True))

    def get_default_latitude(self, obj):
        prof = getattr(obj, "patient_profile", None)
        if not prof or not prof.default_location:
            return None
        return prof.default_location.y

    def get_default_longitude(self, obj):
        prof = getattr(obj, "patient_profile", None)
        if not prof or not prof.default_location:
            return None
        return prof.default_location.x

    def to_internal_value(self, data):
        """Capture lat/lng AVANT validation pour les router vers le PointField."""
        # Champs side-channel : non déclarés mais acceptés en input.
        self._incoming_lat = data.get("default_latitude")
        self._incoming_lng = data.get("default_longitude")
        return super().to_internal_value(data)

    def update(self, instance, validated_data):
        """Dispatche User vs PatientProfile et compose le PointField si lat/lng fournis."""
        from django.contrib.gis.geos import Point
        from .models import PatientProfile

        profile_data = validated_data.pop("patient_profile", {})

        # Champs User
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        # Crée le PatientProfile à la volée s'il manque (cas Google sign-in
        # avant le PatientProfile autocréé, ou compte staff devenu patient).
        profile, _ = PatientProfile.objects.get_or_create(user=instance)

        # Champs PatientProfile
        for attr, value in profile_data.items():
            setattr(profile, attr, value)

        # PointField : on prend les lat/lng captés en to_internal_value
        lat = getattr(self, "_incoming_lat", None)
        lng = getattr(self, "_incoming_lng", None)
        if lat is not None and lng is not None:
            try:
                profile.default_location = Point(float(lng), float(lat), srid=4326)
            except (TypeError, ValueError):
                pass

        profile.save()
        return instance


class StaffLoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)


class GoogleLoginSerializer(serializers.Serializer):
    id_token = serializers.CharField()


class FirebaseLoginSerializer(serializers.Serializer):
    """ID-token Firebase (≠ Google ID-token).

    Le client mobile s'authentifie via Firebase (email/mot de passe ou
    Google via Firebase) puis envoie le `getIdToken()` du `currentUser`
    Firebase. Le backend le vérifie via accounts.services.firebase.
    """
    id_token = serializers.CharField()
