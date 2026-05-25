import uuid
import django.core.validators
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


SAMPLE_TYPE_CHOICES = [
    ("blood", "Sang"),
    ("urine", "Urine"),
    ("stool", "Selles"),
    ("saliva", "Salive"),
    ("swab", "Prélèvement"),
    ("other", "Autre"),
]

SAMPLE_STATUS_CHOICES = [
    ("pending", "À collecter"),
    ("collected", "Collecté"),
    ("received", "Reçu au labo"),
    ("rejected", "Rejeté"),
]

ORDER_STATUS_CHOICES = [
    ("pending", "En attente"),
    ("in_progress", "En cours"),
    ("completed", "Résultat saisi"),
    ("validated", "Validé"),
    ("rejected", "Rejeté"),
]

RESULT_FLAG_CHOICES = [
    ("normal", "Normal"),
    ("low", "Bas"),
    ("high", "Haut"),
    ("critical", "Critique"),
]


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("accounts", "0001_initial"),
        ("laboratories", "0001_initial"),
        ("appointments", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="TestCatalogEntry",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uuid", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("deleted_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("code", models.CharField(db_index=True, max_length=40)),
                ("name", models.CharField(max_length=160)),
                ("description", models.TextField(blank=True)),
                ("sample_type", models.CharField(choices=SAMPLE_TYPE_CHOICES, default="blood", max_length=12)),
                ("price_mru", models.DecimalField(
                    decimal_places=2, max_digits=10,
                    validators=[django.core.validators.MinValueValidator(0)],
                )),
                ("turnaround_hours", models.PositiveSmallIntegerField(default=24)),
                ("requires_fasting", models.BooleanField(default=False)),
                ("is_active", models.BooleanField(db_index=True, default=True)),
                ("laboratory", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="catalog_entries",
                    to="laboratories.laboratory",
                )),
            ],
            options={
                "verbose_name": "test catalog entry",
                "verbose_name_plural": "test catalog entries",
                "ordering": ("name",),
            },
        ),
        migrations.AddConstraint(
            model_name="testcatalogentry",
            constraint=models.UniqueConstraint(
                fields=("laboratory", "code"),
                name="uniq_lab_test_code",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ),
        migrations.AddIndex(
            model_name="testcatalogentry",
            index=models.Index(fields=["laboratory", "is_active"], name="catalog_lab_active_idx"),
        ),

        migrations.CreateModel(
            name="Sample",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uuid", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("deleted_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("barcode", models.CharField(db_index=True, max_length=64, unique=True)),
                ("sample_type", models.CharField(choices=SAMPLE_TYPE_CHOICES, max_length=12)),
                ("status", models.CharField(choices=SAMPLE_STATUS_CHOICES, default="pending", db_index=True, max_length=12)),
                ("collected_at", models.DateTimeField(blank=True, null=True)),
                ("received_at", models.DateTimeField(blank=True, null=True)),
                ("rejection_reason", models.CharField(blank=True, max_length=255)),
                ("appointment", models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name="samples",
                    to="appointments.appointment",
                )),
                ("laboratory", models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name="samples",
                    to="laboratories.laboratory",
                )),
                ("collected_by", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="samples_collected",
                    to=settings.AUTH_USER_MODEL,
                )),
                ("received_by", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="samples_received",
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={"verbose_name": "sample", "verbose_name_plural": "samples", "ordering": ("-created_at",)},
        ),

        migrations.CreateModel(
            name="TestOrder",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uuid", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("deleted_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("status", models.CharField(choices=ORDER_STATUS_CHOICES, default="pending", db_index=True, max_length=12)),
                ("price_mru", models.DecimalField(decimal_places=2, max_digits=10)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("sample", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="orders",
                    to="analyses.sample",
                )),
                ("test", models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name="orders",
                    to="analyses.testcatalogentry",
                )),
                ("technician", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="orders_handled",
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={"verbose_name": "test order", "verbose_name_plural": "test orders", "ordering": ("-created_at",)},
        ),
        migrations.AddIndex(
            model_name="testorder",
            index=models.Index(fields=["status"], name="order_status_idx"),
        ),

        migrations.CreateModel(
            name="TestResult",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uuid", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("deleted_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("value", models.CharField(max_length=120)),
                ("unit", models.CharField(blank=True, max_length=24)),
                ("reference_range", models.CharField(blank=True, max_length=80)),
                ("flag", models.CharField(choices=RESULT_FLAG_CHOICES, default="normal", max_length=12)),
                ("technician_notes", models.TextField(blank=True)),
                ("technician_signed_at", models.DateTimeField(auto_now_add=True)),
                ("biologist_validated_at", models.DateTimeField(blank=True, null=True)),
                ("biologist_comment", models.TextField(blank=True)),
                ("order", models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="result",
                    to="analyses.testorder",
                )),
                ("biologist", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="results_validated",
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={"verbose_name": "test result", "verbose_name_plural": "test results"},
        ),
    ]
