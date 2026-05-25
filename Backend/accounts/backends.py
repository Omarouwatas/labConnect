from __future__ import annotations

from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend
from django.db.models import Q
from typing import Any

UserModel = get_user_model()

class EmailOrPhoneBackend(ModelBackend):
    """Custom authentication backend that allows logging in with email or phone."""

    def authenticate(
        self, request: Any, username: str | None = None, password: str | None = None, **kwargs: Any
    ) -> UserModel | None:
        if username is None:
            username = kwargs.get(UserModel.USERNAME_FIELD)
        if not username:
            return None

        # Look up by email or phone
        try:
            user = UserModel.objects.get(Q(email__iexact=username) | Q(phone=username))
        except UserModel.DoesNotExist:
            return None

        # Verify password (only if user actually has a password set)
        if user.check_password(password):
            return user
        return None
