from django.urls import include, path
from rest_framework.routers import DefaultRouter, SimpleRouter

from .views import ChefLaboratoryViewSet, LaboratoryPublicViewSet
from accounts.views_employees import EmployeeInviteView, EmployeeViewSet, NurseListView

# Public lab listing
public_router = DefaultRouter()
public_router.register("", LaboratoryPublicViewSet, basename="laboratory")

# Employee router — SimpleRouter pour éviter que la APIRootView du
# DefaultRouter ne shadow le list endpoint quand le préfixe est vide.
# `register("", ViewSet)` + include("lab/employees/", ...) résout en :
#   GET  /lab/employees/         → list
#   GET  /lab/employees/{uuid}/  → retrieve
# (Auparavant on avait register("employees", ...) → /lab/employees/employees/ ;
#  le frontend tombait sur l'APIRoot et `asArray` renvoyait []
#  — donc le staff n'apparaissait jamais.)
employee_router = SimpleRouter()
employee_router.register("", EmployeeViewSet, basename="employee")

urlpatterns = [
    # Public: GET /api/v1/laboratories/, /nearby, /{uuid}/
    path("laboratories/", include(public_router.urls)),

    # Chef de labo — multi-labo
    path("lab/mine/",   ChefLaboratoryViewSet.as_view({"get": "mine",   "post": "mine"}),   name="lab-mine"),
    path("lab/config",  ChefLaboratoryViewSet.as_view({"get": "config", "patch": "config"}), name="lab-config"),

    # Lab chief: employee management (scoped via X-Lab-Uuid header)
    # /invite est défini AVANT l'include du router pour ne pas être avalé
    # par le pattern detail `/lab/employees/{uuid}/`.
    path("lab/employees/invite", EmployeeInviteView.as_view(), name="employee-invite"),
    path("lab/employees/", include(employee_router.urls)),

    # Liste des infirmier·es du labo — sélecteur d'affectation côté
    # écran « Tournées ». Tout staff 2FA peut lire (la secrétaire en a
    # besoin pour affecter une visite à domicile).
    path("lab/nurses/", NurseListView.as_view(), name="nurses-list"),
]
