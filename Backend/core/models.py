"""Base models & mixins shared across apps.

Every concrete model should inherit from `BaseModel` so that we uniformly
have created/updated timestamps, soft delete, and UUID primary keys for
external exposure (internal PK stays BigAutoField).
"""
from __future__ import annotations

import uuid

from django.db import models
from django.utils import timezone


class ActiveManager(models.Manager):
    """Default manager that excludes soft-deleted rows."""

    def get_queryset(self) -> models.QuerySet:  # type: ignore[type-arg]
        return super().get_queryset().filter(deleted_at__isnull=True)


class BaseModel(models.Model):
    """Abstract base: uuid, timestamps, soft-delete.

    - `uuid` is exposed in the API (never the internal bigint id).
    - `deleted_at` is set by `soft_delete()`; `active` manager filters them out.
    - `objects` is the full manager (includes soft-deleted); `active` is
      the default-use manager for querysets in views/serializers.
    """

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)

    objects = models.Manager()
    active = ActiveManager()

    class Meta:
        abstract = True
        get_latest_by = "created_at"

    def soft_delete(self) -> None:
        self.deleted_at = timezone.now()
        self.save(update_fields=["deleted_at", "updated_at"])

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None
