from django.contrib.gis import admin as gis_admin

from .models import Laboratory


@gis_admin.register(Laboratory)
class LaboratoryAdmin(gis_admin.GISModelAdmin):
    list_display = (
        "name",
        "slug",
        "is_active",
        "accepts_home_visits",
        "accepts_emergencies",
        "technician_mode",
    )
    list_filter = ("is_active", "accepts_home_visits", "accepts_emergencies", "technician_mode")
    search_fields = ("name", "slug", "address")
    prepopulated_fields = {"slug": ("name",)}
