import uuid
import django.contrib.gis.db.models.fields
import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models

import accounts.managers


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("auth", "0012_alter_user_first_name_max_length"),
        ("laboratories", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="User",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uuid", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("deleted_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("password", models.CharField(max_length=128, verbose_name="password")),
                ("last_login", models.DateTimeField(blank=True, null=True, verbose_name="last login")),
                ("is_superuser", models.BooleanField(
                    default=False,
                    help_text="Designates that this user has all permissions without explicitly assigning them.",
                    verbose_name="superuser status",
                )),
                ("phone", models.CharField(db_index=True, max_length=20, unique=True)),
                ("email", models.EmailField(blank=True, max_length=254)),
                ("first_name", models.CharField(blank=True, max_length=80)),
                ("last_name", models.CharField(blank=True, max_length=80)),
                ("preferred_language", models.CharField(
                    choices=[("fr", "Français"), ("ar", "العربية")],
                    default="fr",
                    max_length=2,
                )),
                ("is_active", models.BooleanField(default=True)),
                ("is_staff", models.BooleanField(default=False)),
                ("date_joined", models.DateTimeField(default=django.utils.timezone.now)),
                ("is_phone_verified", models.BooleanField(default=False)),
                ("groups", models.ManyToManyField(
                    blank=True,
                    help_text="The groups this user belongs to.",
                    related_name="user_set",
                    related_query_name="user",
                    to="auth.group",
                    verbose_name="groups",
                )),
                ("user_permissions", models.ManyToManyField(
                    blank=True,
                    help_text="Specific permissions for this user.",
                    related_name="user_set",
                    related_query_name="user",
                    to="auth.permission",
                    verbose_name="user permissions",
                )),
            ],
            options={"verbose_name": "user", "verbose_name_plural": "users", "ordering": ("-date_joined",), "abstract": False},
            managers=[
                ("objects", accounts.managers.UserManager()),
            ],
        ),
        migrations.CreateModel(
            name="PatientProfile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uuid", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("deleted_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("date_of_birth", models.DateField(blank=True, null=True)),
                ("gender", models.CharField(
                    blank=True, max_length=10,
                    choices=[("male", "Homme"), ("female", "Femme"), ("other", "Autre")],
                )),
                ("national_id", models.CharField(blank=True, max_length=64)),
                ("blood_type", models.CharField(blank=True, max_length=5)),
                ("emergency_contact", models.CharField(blank=True, max_length=20)),
                ("default_address", models.CharField(blank=True, max_length=255)),
                ("default_location", django.contrib.gis.db.models.fields.PointField(blank=True, geography=True, null=True, srid=4326)),
                ("user", models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="patient_profile",
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={"verbose_name": "patient profile", "verbose_name_plural": "patient profiles", "abstract": False},
        ),
        migrations.CreateModel(
            name="StaffProfile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uuid", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("deleted_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("employee_id", models.CharField(blank=True, max_length=50)),
                ("license_number", models.CharField(blank=True, max_length=80)),
                ("is_on_duty", models.BooleanField(default=True)),
                ("laboratory", models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name="staff_members",
                    to="laboratories.laboratory",
                )),
                ("user", models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="staff_profile",
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={"verbose_name": "staff profile", "verbose_name_plural": "staff profiles", "abstract": False},
        ),
        migrations.CreateModel(
            name="OTPCode",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uuid", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("deleted_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("phone", models.CharField(db_index=True, max_length=20)),
                ("purpose", models.CharField(
                    choices=[
                        ("login", "Connexion"),
                        ("register", "Inscription"),
                        ("password_reset", "Réinitialisation mot de passe"),
                        ("verify_phone", "Vérification téléphone"),
                    ],
                    max_length=20,
                )),
                ("salt", models.CharField(max_length=32)),
                ("code_hash", models.CharField(max_length=64)),
                ("expires_at", models.DateTimeField(db_index=True)),
                ("consumed_at", models.DateTimeField(blank=True, null=True)),
                ("attempts", models.PositiveSmallIntegerField(default=0)),
            ],
            options={"verbose_name": "OTP code", "verbose_name_plural": "OTP codes", "abstract": False},
        ),
        migrations.AddIndex(
            model_name="otpcode",
            index=models.Index(fields=["phone", "purpose"], name="accounts_ot_phone_purpose_idx"),
        ),
        migrations.CreateModel(
            name="TOTPDevice",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uuid", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("deleted_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("secret", models.CharField(max_length=64)),
                ("is_confirmed", models.BooleanField(default=False)),
                ("last_used_counter", models.BigIntegerField(default=0)),
                ("user", models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="totp_device",
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={"verbose_name": "TOTP device", "verbose_name_plural": "TOTP devices", "abstract": False},
        ),
    ]
