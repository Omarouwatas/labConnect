"""Trusted device for biometric login (Face ID / fingerprint).

Created after a successful OTP verification on a given device. Only the
SHA-256 hash of the device_token is persisted — the raw token lives in
the device's secure enclave (Keychain on iOS, Keystore on Android).
"""
import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0005_patientprofile_cnam"),
    ]

    operations = [
        migrations.CreateModel(
            name="TrustedDevice",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uuid", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("deleted_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("phone", models.CharField(db_index=True, max_length=20)),
                ("device_id", models.CharField(max_length=64)),
                ("token_hash", models.CharField(max_length=64)),
                ("device_label", models.CharField(blank=True, max_length=120)),
                ("platform", models.CharField(blank=True, max_length=20)),
                ("last_used_at", models.DateTimeField(blank=True, null=True)),
                ("revoked_at", models.DateTimeField(blank=True, null=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="trusted_devices",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "trusted device",
                "verbose_name_plural": "trusted devices",
            },
        ),
        migrations.AddConstraint(
            model_name="trusteddevice",
            constraint=models.UniqueConstraint(
                fields=("user", "device_id"), name="uniq_trusted_user_device"
            ),
        ),
        migrations.AddIndex(
            model_name="trusteddevice",
            index=models.Index(fields=["phone", "device_id"], name="accounts_tr_phone_8a1f3c_idx"),
        ),
    ]
