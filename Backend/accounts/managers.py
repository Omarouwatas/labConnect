"""Custom manager for the phone-based User model."""
from __future__ import annotations

from typing import Any

from django.contrib.auth.base_user import BaseUserManager
from django.db import models


class UserManager(BaseUserManager):
    """Manager that uses `phone` as the unique identifier (no `username`)."""

    use_in_migrations = True

    def _create_user(
        self, phone: str | None, password: str | None, **extra: Any
    ) -> "models.Model":
        # pop (not get) — `email` is forwarded as a kwarg to self.model below.
        email = extra.pop("email", None)
        if not phone and not email:
            raise ValueError("Either phone number or email is required")
        if phone:
            phone = self.model.normalize_phone(phone)
        if email:
            email = self.normalize_email(email)
        user = self.model(phone=phone, email=email, **extra)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_user(
        self, phone: str | None = None, password: str | None = None, **extra: Any
    ) -> "models.Model":
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create_user(phone, password, **extra)

    def create_superuser(
        self, phone: str | None = None, password: str | None = None, **extra: Any
    ) -> "models.Model":
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        if extra.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")
        if not phone:
            email = extra.get("email")
            if not email:
                raise ValueError("Superuser must have at least a phone number or email address.")
        return self._create_user(phone, password, **extra)
