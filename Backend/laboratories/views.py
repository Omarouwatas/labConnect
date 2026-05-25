"""Laboratory views."""
from __future__ import annotations

from django.contrib.gis.db.models.functions import Distance
from django.contrib.gis.geos import Point
from django.db import transaction
from django.utils.text import slugify
from rest_framework import mixins, permissions, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.request import Request
from rest_framework.response import Response

from accounts.models import StaffProfile
from core.permissions import (
    IsLabChief,
    IsStaffAnd2FA,
    LabScopedQuerysetMixin,
    RoleNames,
    current_lab_id,
)

from .models import Laboratory
from .serializers import (
    LaboratoryConfigSerializer,
    LaboratoryDetailSerializer,
    LaboratoryListSerializer,
)


class LaboratoryPublicViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Public, read-only listing of labs — no auth required."""

    queryset = Laboratory.active.filter(is_active=True)
    serializer_class = LaboratoryListSerializer
    permission_classes = (permissions.AllowAny,)
    lookup_field = "uuid"

    def get_serializer_class(self):  # type: ignore[no-untyped-def]
        if self.action == "retrieve":
            return LaboratoryDetailSerializer
        return LaboratoryListSerializer

    @action(detail=False, methods=["get"], url_path="nearby")
    def nearby(self, request: Request) -> Response:
        """GET /api/v1/laboratories/nearby?lat=&lng=&radius_km=10"""
        try:
            lat = float(request.query_params["lat"])
            lng = float(request.query_params["lng"])
        except (KeyError, ValueError) as exc:
            raise ValidationError("lat et lng sont requis (nombres décimaux).") from exc
        radius_km = float(request.query_params.get("radius_km", 10))
        user_point = Point(lng, lat, srid=4326)

        qs = (
            self.get_queryset()
            .annotate(distance=Distance("location", user_point))
            .filter(distance__lte=radius_km * 1000)
            .order_by("distance")
        )
        return Response(self.get_serializer(qs, many=True).data)


# ── Chef de labo : créer / lister / configurer ses labos ─────────────


class LaboratoryCreateSerializer(serializers.ModelSerializer):
    """Création d'un labo par un chef.

    `latitude` / `longitude` sont facultatifs ; valeurs par défaut sur
    Nouakchott si non fournis.
    """
    latitude = serializers.FloatField(required=False)
    longitude = serializers.FloatField(required=False)

    class Meta:
        model = Laboratory
        fields = (
            "name", "address", "phone", "email", "description",
            "latitude", "longitude",
            "accepts_home_visits", "accepts_emergencies",
            "technician_mode",
            "home_visit_fee_mru", "emergency_fee_mru",
        )

    def validate(self, attrs):
        attrs.setdefault("address", "Nouakchott, Mauritanie")
        return attrs

    def create(self, validated_data):
        lat = validated_data.pop("latitude", 18.0735)
        lng = validated_data.pop("longitude", -15.9582)
        name = validated_data["name"]
        # Slug unique
        base = slugify(name) or "labo"
        slug = base
        i = 1
        while Laboratory.objects.filter(slug=slug).exists():
            i += 1
            slug = f"{base}-{i}"
        validated_data["slug"] = slug
        validated_data["location"] = Point(lng, lat, srid=4326)
        validated_data["is_active"] = True
        return Laboratory.objects.create(**validated_data)


class ChefLaboratoryViewSet(viewsets.GenericViewSet):
    """Endpoints multi-labo pour le chef de labo (et staff).

    GET    /api/v1/lab/mine/                  → labos rattachés à l'utilisateur
    POST   /api/v1/lab/mine/                  → créer un nouveau labo (chef)
    GET    /api/v1/lab/config                 → labo actif (header X-Lab-Uuid)
    PATCH  /api/v1/lab/config                 → mise à jour labo actif
    """

    permission_classes = (IsStaffAnd2FA,)
    queryset = Laboratory.active.filter(is_active=True)

    def _user_labs(self):
        lab_ids = StaffProfile.active.filter(user=self.request.user).values_list("laboratory_id", flat=True)
        return Laboratory.active.filter(pk__in=lab_ids, is_active=True)

    @action(detail=False, methods=["get", "post"], url_path="mine")
    def mine(self, request: Request) -> Response:
        if request.method == "GET":
            return Response(LaboratoryDetailSerializer(self._user_labs(), many=True).data)

        # POST → création d'un labo par un chef
        if not request.user.groups.filter(name=RoleNames.LAB_CHIEF).exists():
            return Response(
                {"error": {"code": "forbidden", "detail": "Seul un chef de labo peut créer un laboratoire."}},
                status=status.HTTP_403_FORBIDDEN,
            )
        ser = LaboratoryCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        with transaction.atomic():
            lab = ser.save()
            # Rattache automatiquement le chef à ce labo
            StaffProfile.objects.create(
                user=request.user,
                laboratory=lab,
                employee_id="CHIEF",
                is_on_duty=True,
            )
        return Response(LaboratoryDetailSerializer(lab).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get", "patch"], url_path="config")
    def config(self, request: Request) -> Response:
        lab_id = current_lab_id(request)
        if not lab_id:
            raise NotFound("Aucun laboratoire actif pour cet utilisateur.")
        try:
            lab = self.queryset.get(pk=lab_id)
        except Laboratory.DoesNotExist as exc:
            raise NotFound("Laboratoire introuvable.") from exc

        if request.method == "GET":
            return Response(LaboratoryDetailSerializer(lab).data)

        # PATCH — réservé au chef
        if not request.user.groups.filter(name=RoleNames.LAB_CHIEF).exists():
            return Response(
                {"error": {"code": "forbidden", "detail": "Réservé au chef de labo."}},
                status=status.HTTP_403_FORBIDDEN,
            )
        ser = LaboratoryConfigSerializer(lab, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(LaboratoryDetailSerializer(lab).data, status=status.HTTP_200_OK)
