from __future__ import annotations

from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    """Lecture : tout ce dont le client a besoin pour afficher la liste
    et faire un deep-link sur tap."""

    class Meta:
        model = Notification
        fields = (
            "uuid",
            "kind", "severity",
            "title", "body",
            "payload",
            "read_at", "created_at",
        )
        read_only_fields = fields
