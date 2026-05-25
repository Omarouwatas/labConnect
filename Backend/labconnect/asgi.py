"""ASGI entry point — serves HTTP + WebSocket (Channels)."""
import os

from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "labconnect.settings.prod")

# HTTP application must be instantiated before importing Channels routing
# to ensure Django apps are loaded.
django_asgi_app = get_asgi_application()

# WebSocket routes will be populated when the `realtime` app is added.
websocket_urlpatterns: list = []

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": URLRouter(websocket_urlpatterns),
    }
)
