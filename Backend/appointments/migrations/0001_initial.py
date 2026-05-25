import uuid
import django.contrib.gis.db.models.fields
import django.core.validators
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("accounts", "0001_initial"),
        ("laboratories", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="Appointment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uuid", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("deleted_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("visit_type", models.CharField(
                    max_length=20, default="in_lab",
                    choices=[("in_lab", "Au laboratoire"), ("home", "À domicile"), ("emergency", "Urgence")],
                )),
                ("status", models.CharField(
                    max_length=20, default="pending", db_index=True,
                    choices=[
                        ("pending", "En attente"),
                        ("confirmed", "Confirmé"),
                        ("checked_in", "Patient arrivé"),
                        ("in_progress", "En cours"),
                        ("completed", "Terminé"),
                        ("cancelled", "Annulé"),
                        ("no_show", "Absent"),
                    ],
                )),
                ("scheduled_for", models.DateTimeField(db_index=True)),
                ("duration_minutes", models.PositiveSmallIntegerField(default=30)),
                ("home_address", models.CharField(blank=True, max_length=255)),
                ("home_location", django.contrib.gis.db.models.fields.PointField(
                    blank=True, geography=True, null=True, srid=4326)),
                ("base_fee_mru", models.DecimalField(
                    decimal_places=2, default=0, max_digits=10,
                    validators=[django.core.validators.MinValueValidator(0)],
                )),
                ("surcharge_mru", models.DecimalField(
                    decimal_places=2, default=0, max_digits=10,
                    help_text="Frais visite domicile / urgence",
                    validators=[django.core.validators.MinValueValidator(0)],
                )),
                ("notes", models.TextField(blank=True)),
                ("assigned_nurse", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="home_visits",
                    to=settings.AUTH_USER_MODEL,
                )),
                ("created_by", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="appointments_created",
                    to=settings.AUTH_USER_MODEL,
                )),
                ("laboratory", models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name="appointments",
                    to="laboratories.laboratory",
                )),
                ("patient", models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name="appointments",
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                "verbose_name": "appointment",
                "verbose_name_plural": "appointments",
                "ordering": ("-scheduled_for",),
            },
        ),
        migrations.AddIndex(
            model_name="appointment",
            index=models.Index(fields=["laboratory", "scheduled_for"], name="appt_lab_sched_idx"),
        ),
        migrations.AddIndex(
            model_name="appointment",
            index=models.Index(fields=["patient", "scheduled_for"], name="appt_pat_sched_idx"),
        ),
        migrations.AddIndex(
            model_name="appointment",
            index=models.Index(fields=["assigned_nurse", "scheduled_for"], name="appt_nurse_sched_idx"),
        ),
    ]
