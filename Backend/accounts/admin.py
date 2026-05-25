from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import OTPCode, PatientProfile, StaffProfile, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ("-date_joined",)
    list_display = ("phone", "first_name", "last_name", "is_active", "is_staff", "is_phone_verified")
    list_filter = ("is_active", "is_staff", "is_superuser", "is_phone_verified", "groups")
    search_fields = ("phone", "email", "first_name", "last_name")
    fieldsets = (
        (None, {"fields": ("phone", "password")}),
        ("Personnel", {"fields": ("first_name", "last_name", "email", "preferred_language")}),
        (
            "Permissions",
            {
                "fields": (
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "is_phone_verified",
                    "groups",
                    "user_permissions",
                )
            },
        ),
        ("Dates importantes", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("phone", "password1", "password2")}),
    )
    readonly_fields = ("last_login", "date_joined")


@admin.register(PatientProfile)
class PatientProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "gender", "date_of_birth")
    search_fields = ("user__phone", "user__first_name", "user__last_name")


@admin.register(StaffProfile)
class StaffProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "laboratory", "employee_id", "is_on_duty")
    list_filter = ("laboratory", "is_on_duty")
    search_fields = ("user__phone", "employee_id", "license_number")


@admin.register(OTPCode)
class OTPCodeAdmin(admin.ModelAdmin):
    list_display = ("phone", "purpose", "expires_at", "consumed_at", "attempts")
    list_filter = ("purpose",)
    search_fields = ("phone",)
    readonly_fields = ("salt", "code_hash")
