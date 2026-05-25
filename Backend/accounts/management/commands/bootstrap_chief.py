"""Create a local lab chief user and laboratory."""
from __future__ import annotations

from django.contrib.auth.models import Group
from django.contrib.gis.geos import Point
from django.core.management.base import BaseCommand, CommandError
from django.utils.text import slugify

from accounts.models import StaffProfile, User
from core.permissions import RoleNames
from laboratories.models import Laboratory


class Command(BaseCommand):
    help = "Create or update a laboratory and assign a phone user as lab_chief."

    def add_arguments(self, parser):
        parser.add_argument("--phone", default="+22242382780")
        parser.add_argument("--first-name", default="Chef")
        parser.add_argument("--last-name", default="Labo")
        parser.add_argument("--lab-name", default="SmartLab Nouakchott")
        parser.add_argument("--address", default="Nouakchott")
        parser.add_argument("--lat", type=float, default=18.0735)
        parser.add_argument("--lng", type=float, default=-15.9582)

    def handle(self, *args, **options):
        try:
            phone = User.normalize_phone(options["phone"])
        except ValueError as exc:
            raise CommandError(str(exc)) from exc

        for role in RoleNames.ALL:
            Group.objects.get_or_create(name=role)

        lab_name = options["lab_name"]
        slug = slugify(lab_name) or "smartlab"
        lab, lab_created = Laboratory.objects.update_or_create(
            slug=slug,
            defaults={
                "name": lab_name,
                "address": options["address"],
                "phone": phone,
                "location": Point(options["lng"], options["lat"], srid=4326),
                "is_active": True,
                "accepts_home_visits": True,
                "accepts_emergencies": True,
                "home_visit_fee_mru": 300,
                "emergency_fee_mru": 500,
            },
        )

        user, user_created = User.objects.get_or_create(phone=phone)
        user.first_name = options["first_name"]
        user.last_name = options["last_name"]
        user.is_staff = True
        user.is_active = True
        user.is_phone_verified = True
        user.save(update_fields=[
            "first_name",
            "last_name",
            "is_staff",
            "is_active",
            "is_phone_verified",
            "updated_at",
        ])

        chief_group = Group.objects.get(name=RoleNames.LAB_CHIEF)
        user.groups.add(chief_group)

        StaffProfile.objects.update_or_create(
            user=user,
            defaults={
                "laboratory": lab,
                "employee_id": "CHIEF-001",
                "is_on_duty": True,
            },
        )

        self.stdout.write(
            self.style.SUCCESS(
                f"{'Created' if user_created else 'Updated'} lab chief {phone} "
                f"for {'created' if lab_created else 'existing'} lab {lab.name}."
            )
        )
