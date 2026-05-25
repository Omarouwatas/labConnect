from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "accounts"
    verbose_name = "Accounts & authentication"

    def ready(self) -> None:
        # Import signals when app is fully loaded
        from . import signals  # noqa: F401
