"""Celery application for LabConnect."""
import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "labconnect.settings.dev")

app = Celery("labconnect")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()


@app.task(bind=True, ignore_result=True)
def debug_task(self) -> None:  # type: ignore[no-untyped-def]
    print(f"Request: {self.request!r}")
