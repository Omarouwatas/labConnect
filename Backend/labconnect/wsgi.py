"""WSGI entry point — used by gunicorn for synchronous HTTP."""
import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "labconnect.settings.prod")

application = get_wsgi_application()
