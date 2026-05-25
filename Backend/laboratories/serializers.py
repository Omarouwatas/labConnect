"""Laboratory serializers."""
from __future__ import annotations

from rest_framework import serializers

from .models import Laboratory

# Days and their French labels — for opening hours validation
DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


class DayHoursSerializer(serializers.Serializer):
    """Validates a single day's opening hours."""
    closed = serializers.BooleanField(default=False)
    open = serializers.TimeField(required=False, format="%H:%M", input_formats=["%H:%M"])
    close = serializers.TimeField(required=False, format="%H:%M", input_formats=["%H:%M"])

    def validate(self, data: dict) -> dict:
        if not data.get("closed"):
            if "open" not in data or "close" not in data:
                raise serializers.ValidationError(
                    "Les champs 'open' et 'close' sont requis si le jour n'est pas fermé."
                )
            if data["open"] >= data["close"]:
                raise serializers.ValidationError(
                    "L'heure d'ouverture doit être antérieure à l'heure de fermeture."
                )
        return data


class OpeningHoursSerializer(serializers.Serializer):
    """Validates the full opening_hours JSONField."""
    mon = DayHoursSerializer(required=False)
    tue = DayHoursSerializer(required=False)
    wed = DayHoursSerializer(required=False)
    thu = DayHoursSerializer(required=False)
    fri = DayHoursSerializer(required=False)
    sat = DayHoursSerializer(required=False)
    sun = DayHoursSerializer(required=False)


class LaboratoryListSerializer(serializers.ModelSerializer):
    """Public read-only serializer for lab listings."""
    latitude = serializers.SerializerMethodField()
    longitude = serializers.SerializerMethodField()

    class Meta:
        model = Laboratory
        fields = (
            "uuid",
            "name",
            "slug",
            "address",
            "phone",
            "latitude",
            "longitude",
            "accepts_home_visits",
            "accepts_emergencies",
            "home_visit_fee_mru",
            "emergency_fee_mru",
            "logo",
            "description",
        )

    def get_latitude(self, obj: Laboratory) -> float | None:
        return obj.location.y if obj.location else None

    def get_longitude(self, obj: Laboratory) -> float | None:
        return obj.location.x if obj.location else None


class LaboratoryDetailSerializer(LaboratoryListSerializer):
    """Full detail — includes opening_hours (for lab chief and public view)."""
    class Meta(LaboratoryListSerializer.Meta):
        fields = LaboratoryListSerializer.Meta.fields + (
            "opening_hours",
            "technician_mode",
        )


class LaboratoryConfigSerializer(serializers.ModelSerializer):
    """Lab chief update serializer — writable, validates opening_hours."""
    opening_hours = serializers.JSONField(required=False)

    class Meta:
        model = Laboratory
        fields = (
            "name",
            "phone",
            "email",
            "address",
            "description",
            "logo",
            "accepts_home_visits",
            "accepts_emergencies",
            "technician_mode",
            "home_visit_fee_mru",
            "emergency_fee_mru",
            "opening_hours",
        )

    def validate_opening_hours(self, value: dict) -> dict:
        """Validate each day using DayHoursSerializer."""
        errors: dict = {}
        for day in DAYS:
            if day in value:
                day_ser = DayHoursSerializer(data=value[day])
                if not day_ser.is_valid():
                    errors[day] = day_ser.errors
        if errors:
            raise serializers.ValidationError(errors)
        return value

    def validate_home_visit_fee_mru(self, value: object) -> object:
        lab = self.instance
        if value and lab and not lab.accepts_home_visits:
            raise serializers.ValidationError(
                "Activez d'abord les visites à domicile avant de fixer les frais."
            )
        return value

    def validate_emergency_fee_mru(self, value: object) -> object:
        lab = self.instance
        if value and lab and not lab.accepts_emergencies:
            raise serializers.ValidationError(
                "Activez d'abord le mode urgence avant de fixer les frais."
            )
        return value
