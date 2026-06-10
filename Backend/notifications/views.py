"""Endpoints notifications.

GET  /api/v1/notifications/mine/       — liste paginée des notifs de
                                          l'utilisateur connecté (le
                                          plus récent en premier).
GET  /api/v1/notifications/unread/     — compteur seul (utilisé par la
                                          cloche, plus léger qu'un fetch
                                          complet pour un simple badge).
PATCH /api/v1/notifications/{uuid}/read/   — marque une notif comme lue.
POST  /api/v1/notifications/read-all/      — marque tout comme lu.

Pas d'écriture côté client : les notifications sont émises uniquement
par le backend via `notifications.events`.
"""
from __future__ import annotations

from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ViewSet

from .models import Notification
from .serializers import NotificationSerializer


class NotificationViewSet(ViewSet):
    permission_classes = (permissions.IsAuthenticated,)

    @action(detail=False, methods=["get"], url_path="mine")
    def mine(self, request):
        """Liste les notifications du user connecté.

        Query params :
          - unread=1 : ne retourne que les non lues
          - limit=N  : limite (default 50, cap 200)
        """
        qs = Notification.active.filter(user=request.user).order_by("-created_at")
        if request.query_params.get("unread") == "1":
            qs = qs.filter(read_at__isnull=True)
        try:
            limit = min(int(request.query_params.get("limit", 50)), 200)
        except (TypeError, ValueError):
            limit = 50
        data = NotificationSerializer(qs[:limit], many=True).data
        # On garde une petite enveloppe pour transporter le compteur
        # unread global — utile pour les badges côté UI.
        unread = Notification.active.filter(
            user=request.user, read_at__isnull=True,
        ).count()
        return Response({"results": data, "unread": unread})

    @action(detail=False, methods=["get"], url_path="unread")
    def unread(self, request):
        """Compteur seul — léger, appelé fréquemment par la cloche."""
        unread = Notification.active.filter(
            user=request.user, read_at__isnull=True,
        ).count()
        return Response({"unread": unread})

    @action(detail=True, methods=["patch"], url_path="read", lookup_field="uuid")
    def mark_read(self, request, uuid=None):
        try:
            notif = Notification.active.get(uuid=uuid, user=request.user)
        except Notification.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)
        notif.mark_read()
        return Response(NotificationSerializer(notif).data)

    @action(detail=False, methods=["post"], url_path="read-all")
    def mark_all_read(self, request):
        now = timezone.now()
        n = Notification.active.filter(
            user=request.user, read_at__isnull=True,
        ).update(read_at=now, updated_at=now)
        return Response({"marked": n})
