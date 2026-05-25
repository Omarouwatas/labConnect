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
    roles = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "uuid",
            "phone",
            "email",
            "first_name",
            "last_name",
            "preferred_language",
            "is_phone_verified",
            "roles",
        )
        read_only_fields = ("uuid", "phone", "is_phone_verified", "roles")

    def get_roles(self, obj: User) -> list[str]:
        return list(obj.groups.values_list("name", flat=True))


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
