"""Démarre Django sur 0.0.0.0:8000 + affiche l'IP LAN à utiliser sur mobile.

Usage :
    python manage.py runlan

Pratique pour tester depuis un iPhone / Android sur le même WiFi :
le script imprime quelque chose comme « http://192.168.1.42:8000 »
pour que tu n'aies pas à chercher l'IP toi-même.
"""
from __future__ import annotations

import socket
from django.core.management.commands.runserver import Command as RunServer


def _lan_ip() -> str:
    """Renvoie l'IP locale joignable par les autres appareils du WiFi."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Pas besoin d'envoyer quoi que ce soit ; juste choisir une route.
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


class Command(RunServer):
    help = "runserver 0.0.0.0:8000 avec affichage de l'IP LAN."

    default_addr = "0.0.0.0"
    default_port = "8000"

    def handle(self, *args, **options):
        ip = _lan_ip()
        bar = "─" * 60
        self.stdout.write(self.style.SUCCESS(f"\n{bar}"))
        self.stdout.write(self.style.SUCCESS("📡 labConnect — backend prêt pour les mobiles du WiFi"))
        self.stdout.write(self.style.SUCCESS(bar))
        self.stdout.write(self.style.WARNING(f"  Sur ton iPhone / Android : http://{ip}:8000"))
        self.stdout.write(self.style.WARNING(f"  Vérification rapide      : http://{ip}:8000/api/v1/laboratories/"))
        self.stdout.write(f"  (depuis ce PC localhost)  : http://127.0.0.1:8000")
        self.stdout.write(self.style.SUCCESS(bar))
        self.stdout.write(
            "  💡 L'app Expo détecte cette IP automatiquement via le QR code.\n"
            "     Tu n'as RIEN à mettre en dur dans app.json.\n"
        )

        # Force l'adresse + port
        options["addrport"] = f"{self.default_addr}:{self.default_port}"
        super().handle(*args, **options)
