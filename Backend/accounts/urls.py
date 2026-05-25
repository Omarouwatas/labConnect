from django.urls import path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from .views import LogoutView, MeView, OTPRequestView, OTPVerifyView, StaffLoginView, GoogleLoginView, PatientEmailLoginView, PatientGoogleLoginView
from .views_totp import TOTPConfirmView, TOTPDeviceDeleteView, TOTPSetupView, TOTPVerifyView
from .views_employees import EmployeeInviteView, EmployeeViewSet

app_name = "accounts"

# Employee router
employee_router = DefaultRouter()
employee_router.register("", EmployeeViewSet, basename="employee")

urlpatterns = [
    # ── Auth (patient + staff) ─────────────────────────────────────────
    path("otp/request/", OTPRequestView.as_view(), name="otp-request"),
    path("otp/verify/", OTPVerifyView.as_view(), name="otp-verify"),
    path("login/staff/", StaffLoginView.as_view(), name="staff-login"),
    path("login/email/", PatientEmailLoginView.as_view(), name="patient-email-login"),
    path("login/google/", GoogleLoginView.as_view(), name="google-login"),
    path("login/google/patient/", PatientGoogleLoginView.as_view(), name="patient-google-login"),
    path("refresh/", TokenRefreshView.as_view(), name="token-refresh"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("me/", MeView.as_view(), name="me"),

    # ── TOTP 2FA (staff only) ──────────────────────────────────────────
    path("totp/setup/", TOTPSetupView.as_view(), name="totp-setup"),
    path("totp/confirm/", TOTPConfirmView.as_view(), name="totp-confirm"),
    path("totp/verify/", TOTPVerifyView.as_view(), name="totp-verify"),
    path("totp/device/", TOTPDeviceDeleteView.as_view(), name="totp-device-delete"),
]
