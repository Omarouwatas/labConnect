"""Create a `lab_chief` user account.

Unlike `bootstrap_chief`, this command does NOT create a laboratory.
The chef will create their own labs after login via the web UI
(POST /api/v1/lab/mine/).

Usage:
    python manage.py create_chef \\
        --email chef@smartlab.mr \\
        --password 22722773 \\
        --first-name "Chef" --last-name "Labo"
"""
from __future__ import annotations

from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand, CommandError

from accounts.models import User
from core.permissions import RoleNames


class Command(BaseCommand):
    help = "Create (or update) a chef de labo account without attaching a laboratory."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--password", required=True)
        parser.add_argument("--phone", default="", help="E.164 phone, optional")
        parser.add_argument("--first-name", default="Chef")
        parser.add_argument("--last-name", default="Labo")

    def handle(self, *args, **options):
        email = options["email"].lower().strip()
        if not email:
            raise CommandError("--email is required.")
        password = options["password"]
        if len(password) < 6:
            raise CommandError("Password too short (min 6 chars).")

        phone = options["phone"].strip() or None
        if phone:
            try:
                phone = User.normalize_phone(phone)
            except ValueError as exc:
                raise CommandError(str(exc)) from exc

        # Ensure groups exist
        for role in RoleNames.ALL:
            Group.objects.get_or_create(name=role)

        user, created = User.objects.get_or_create(email=email)
        user.first_name = options["first_name"]
        user.last_name = options["last_name"]
        user.is_active = True
        user.is_phone_verified = bool(phone)
        if phone:
            user.phone = phone
        user.set_password(password)
        user.save()

        chief_group = Group.objects.get(name=RoleNames.LAB_CHIEF)
        user.groups.add(chief_group)

        self.stdout.write(self.style.SUCCESS(
            f"{'Created' if created else 'Updated'} chef de labo: {email} "
            f"({user.first_name} {user.last_name}). "
            f"Aucun laboratoire attaché — le chef pourra créer ses labos depuis l'interface."
        ))
