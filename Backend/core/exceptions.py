"""Custom API exception handler — adds a stable `code` and keeps shape consistent."""
from __future__ import annotations

from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_default_handler


def api_exception_handler(exc: Exception, context: dict) -> Response | None:
    """Wrap DRF default handler with a consistent error envelope.

    Response shape:
        {"error": {"code": "validation_error", "detail": <drf detail>}}
    """
    response = drf_default_handler(exc, context)
    if response is None:
        return None
    code = getattr(exc, "default_code", "error")
    response.data = {"error": {"code": code, "detail": response.data}}
    return response
