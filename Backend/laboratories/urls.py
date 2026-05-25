from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ChefLaboratoryViewSet, LaboratoryPublicViewSet
from accounts.views_employees import EmployeeInviteView, EmployeeViewSet

# Public lab listing
public_router = DefaultRouter()
public_router.register("", LaboratoryPublicViewSet, basename="laboratory")

# Employee router (nested under /lab/)
employee_router = DefaultRouter()
employee_router.register("employees", EmployeeViewSet, basename="employee")

urlpatterns = [
    # Public: GET /api/v1/laboratories/, /nearby, /{uuid}/
    path("laboratories/", include(public_router.urls)),

    # Chef de labo — multi-labo
    path("lab/mine/",   ChefLaboratoryViewSet.as_view({"get": "mine",   "post": "mine"}),   name="lab-mine"),
    path("lab/config",  ChefLaboratoryViewSet.as_view({"get": "config", "patch": "config"}), name="lab-config"),

    # Lab chief: employee management (scoped via X-Lab-Uuid header)
    path("lab/employees/invite", EmployeeInviteView.as_view(), name="employee-invite"),
    path("lab/employees/", include(employee_router.urls)),
]
