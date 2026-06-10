from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    CatalogViewSet,
    InvoiceView,
    MyResultsView,
    OrderViewSet,
    ResultPDFView,
    SampleViewSet,
    StatsView,
    WalkInView,
)

router = DefaultRouter()
router.register("lab/catalog", CatalogViewSet, basename="catalog")
router.register("lab/samples", SampleViewSet, basename="sample")
router.register("lab/orders", OrderViewSet, basename="order")

urlpatterns = router.urls + [
    path("results/mine/", MyResultsView.as_view({"get": "list"}), name="my-results"),
    path("lab/walk-in/", WalkInView.as_view(), name="lab-walk-in"),
    path("lab/invoices/<uuid:appointment_uuid>/", InvoiceView.as_view(), name="lab-invoice"),
    path("lab/stats/", StatsView.as_view(), name="lab-stats"),
    # PDF du résultat validé (accessible patient OU staff).
    path("lab/orders/<uuid:uuid>/result/pdf/", ResultPDFView.as_view(), name="result-pdf"),
]
