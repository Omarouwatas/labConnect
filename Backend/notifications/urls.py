"""Notifications URLs — montées sous /api/v1/."""
from __future__ import annotations

from django.urls import path

from .views import NotificationViewSet

# On expose chaque action comme une vue dédiée plutôt que de passer par
# un DefaultRouter, parce que notre ViewSet n'expose pas list/create
# au sens DRF standard — seulement les `@action`.
urlpatterns = [
    path(
        "notifications/mine/",
        NotificationViewSet.as_view({"get": "mine"}),
        name="notifications-mine",
    ),
    path(
        "notifications/unread/",
        NotificationViewSet.as_view({"get": "unread"}),
        name="notifications-unread",
    ),
    path(
        "notifications/<uuid:uuid>/read/",
        NotificationViewSet.as_view({"patch": "mark_read"}),
        name="notifications-mark-read",
    ),
    path(
        "notifications/read-all/",
        NotificationViewSet.as_view({"post": "mark_all_read"}),
        name="notifications-mark-all-read",
    ),
]
