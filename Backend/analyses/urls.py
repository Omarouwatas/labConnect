from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import CatalogViewSet, MyResultsView, OrderViewSet, SampleViewSet

router = DefaultRouter()
router.register("lab/catalog", CatalogViewSet, basename="catalog")
router.register("lab/samples", SampleViewSet, basename="sample")
router.register("lab/orders", OrderViewSet, basename="order")

urlpatterns = router.urls + [
    path("results/mine/", MyResultsView.as_view({"get": "list"}), name="my-results"),
]
