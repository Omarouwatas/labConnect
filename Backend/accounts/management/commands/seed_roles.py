"""Seed the six canonical Django Groups used for RBAC.

Idempotent — run after every `migrate` in dev and on deploy.
"""
from __future__ import annotations

from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand

from core.permissions import RoleNames


class Command(BaseCommand):
    help = "Create the six LabConnect role Groups (patient, secretary, nurse, technician, biologist, lab_chief)."

    def handle(self, *args: object, **options: object) -> None:
        for role in RoleNames.ALL:
            obj, created = Group.objects.get_or_create(name=role)
            verb = "created" if created else "exists"
            self.stdout.write(f"  - {role}: {verb}")
        self.stdout.write(self.style.SUCCESS("Roles seeded."))
