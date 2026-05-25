import uuid
import django.contrib.gis.db.models.fields
import django.core.validators
import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models

import laboratories.models


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Laboratory",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uuid", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("deleted_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("name", models.CharField(max_length=150)),
                ("slug", models.SlugField(max_length=160, unique=True)),
                ("address", models.CharField(max_length=255)),
                ("location", django.contrib.gis.db.models.fields.PointField(db_index=True, geography=True, srid=4326)),
                ("phone", models.CharField(blank=True, max_length=20)),
                ("email", models.EmailField(blank=True, max_length=254)),
                ("logo", models.ImageField(blank=True, null=True, upload_to="lab_logos/")),
                ("description", models.TextField(blank=True)),
                ("opening_hours", models.JSONField(default=laboratories.models.default_opening_hours)),
                ("accepts_home_visits", models.BooleanField(default=False)),
                ("accepts_emergencies", models.BooleanField(default=False)),
                ("technician_mode", models.CharField(
                    choices=[("separate", "Technicien distinct du biologiste"), ("merged_with_biologist", "Technicien fusionné avec le biologiste")],
                    default="separate",
                    max_length=32,
                )),
                ("home_visit_fee_mru", models.DecimalField(
                    decimal_places=2, default=0, max_digits=10,
                    validators=[django.core.validators.MinValueValidator(0)],
                )),
                ("emergency_fee_mru", models.DecimalField(
                    decimal_places=2, default=0, max_digits=10,
                    validators=[django.core.validators.MinValueValidator(0)],
                )),
                ("is_active", models.BooleanField(db_index=True, default=True)),
            ],
            options={"verbose_name": "laboratory", "verbose_name_plural": "laboratories", "ordering": ("name",), "abstract": False},
        ),
    ]
