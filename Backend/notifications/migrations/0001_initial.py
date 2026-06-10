import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Notification",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uuid", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("deleted_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("kind", models.CharField(
                    choices=[
                        ("appt_created", "RDV créé"),
                        ("appt_confirmed", "RDV confirmé"),
                        ("appt_checked_in", "Patient arrivé"),
                        ("appt_in_progress", "Visite démarrée"),
                        ("appt_completed", "Visite terminée"),
                        ("appt_cancelled", "RDV annulé"),
                        ("appt_nurse_assigned", "Infirmier·e affecté·e"),
                        ("sample_received", "Échantillon reçu"),
                        ("result_entered", "Résultat saisi"),
                        ("result_validated", "Résultat validé"),
                        ("result_available", "Résultat disponible"),
                        ("sample_rejected", "Échantillon rejeté"),
                        ("info", "Information"),
                    ],
                    default="info",
                    max_length=40,
                )),
                ("severity", models.CharField(
                    choices=[
                        ("success", "Succès"),
                        ("info", "Information"),
                        ("warning", "Attention"),
                        ("critical", "Critique"),
                    ],
                    default="info",
                    max_length=10,
                )),
                ("title", models.CharField(max_length=160)),
                ("body", models.TextField(blank=True)),
                ("payload", models.JSONField(blank=True, default=dict)),
                ("read_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("user", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="notifications",
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                "ordering": ("-created_at",),
            },
        ),
        migrations.AddIndex(
            model_name="notification",
            index=models.Index(fields=["user", "-created_at"], name="notif_user_created_idx"),
        ),
        migrations.AddIndex(
            model_name="notification",
            index=models.Index(fields=["user", "read_at"], name="notif_user_read_idx"),
        ),
    ]
