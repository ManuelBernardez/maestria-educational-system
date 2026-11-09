"""Administrative API backed by the existing Supabase public schema.

Global roles are read from user_profile. Institutional roles are separate rows
in institution_membership and never grant global administrative access.
"""
from django.db import connection, IntegrityError, transaction
from django.db.models import Q, CharField
from django.db.models.functions import Cast, Lower, Trim
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import (
    AIProviderConfig, AuditEvent, ContactMessage, Institution,
    InstitutionMembership, UserProfile,
)
from .client_ip import client_ip
from .permissions import IsGlobalAdmin, active_memberships, active_profile, global_role

SUPERADMIN_GUARD_LOCK = (1297303908, 1)


def auth_user_exists(user_id):
    """Consulta Supabase Auth sin acceso directo al esquema auth (AUD-006).

    El rol de mínimo privilegio `maestria_app` no puede leer auth.users; la función
    SECURITY DEFINER sólo responde si la identidad existe.
    """
    with connection.cursor() as cursor:
        cursor.execute("SELECT public.maestria_auth_user_exists(%s::uuid)", [str(user_id)])
        row = cursor.fetchone()
    return bool(row and row[0])


def _audit(request, event_type, object_type, object_id, detail=None):
    role = global_role(request.user) or "teacher"
    ip = client_ip(request)
    AuditEvent.objects.create(
        owner_id=request.user.id,
        actor_user_id=request.user.id,
        actor_role=role,
        event_type=event_type,
        object_type=object_type,
        object_id=str(object_id),
        request_id=getattr(request, "request_id", None),
        ip_address=ip,
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:1000] or None,
        detail=detail or {},
    )


class GlobalAdminViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsGlobalAdmin]

    def _audit(self, event, obj_type, obj_id, detail=None):
        _audit(self.request, event, obj_type, obj_id, detail)


class PublicContactMessageSerializer(serializers.ModelSerializer):
    website = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = ContactMessage
        fields = ("name", "email", "subject", "message", "category", "website")

    def to_internal_value(self, data):
        if not hasattr(data, "keys"):
            raise serializers.ValidationError({"non_field_errors": ["El cuerpo debe ser un objeto JSON."]})
        allowed = {"name", "email", "subject", "message", "category", "website"}
        forbidden = set(data.keys()) - allowed
        if forbidden:
            raise serializers.ValidationError({key: "Este campo no se puede establecer desde el formulario público." for key in sorted(forbidden)})
        return super().to_internal_value(data)

    def validate_website(self, value):
        if value.strip():
            raise serializers.ValidationError("Solicitud inválida.")
        return value

    def validate_name(self, value):
        value = value.strip()
        if not value or len(value) > 120:
            raise serializers.ValidationError("Indicá un nombre válido.")
        return value

    def validate_email(self, value):
        return value.strip().lower()

    def validate_subject(self, value):
        value = value.strip()
        if not value or len(value) > 240:
            raise serializers.ValidationError("Indicá un asunto válido.")
        return value

    def validate_message(self, value):
        value = value.strip()
        if not 10 <= len(value) <= 4000:
            raise serializers.ValidationError("El mensaje debe tener entre 10 y 4.000 caracteres.")
        return value

    def validate_category(self, value):
        value = value.strip().lower() or "general"
        if len(value) > 80:
            raise serializers.ValidationError("La categoría es demasiado extensa.")
        return value


class ContactMessageAdminSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContactMessage
        fields = (
            "id", "name", "email", "subject", "message", "category", "source",
            "status", "internal_notes", "assigned_to", "assigned_at", "handled_at",
            "created_at", "updated_at", "user_id", "metadata",
        )
        read_only_fields = (
            "id", "name", "email", "subject", "message", "category", "source",
            "assigned_at", "handled_at", "created_at", "updated_at", "user_id", "metadata",
        )

    def validate_assigned_to(self, value):
        if value is None:
            return value
        profile = UserProfile.objects.filter(user_id=value, role__in=["admin", "superadmin"], status="active").first()
        if not profile:
            raise serializers.ValidationError("El responsable debe ser un administrador global activo.")
        return value

    def validate_status(self, value):
        if value not in {"new", "in_progress", "handled", "spam"}:
            raise serializers.ValidationError("Estado de mensaje no válido.")
        return value

    def validate_internal_notes(self, value):
        if len(value) > 10_000:
            raise serializers.ValidationError("Las notas internas no pueden superar 10.000 caracteres.")
        return value.strip()


class ContactMessageAdminViewSet(GlobalAdminViewSet):
    queryset = ContactMessage.objects.all()
    serializer_class = ContactMessageAdminSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        state = self.request.query_params.get("status")
        category = self.request.query_params.get("category")
        term = self.request.query_params.get("q", "").strip()[:160]
        if state:
            qs = qs.filter(status=state)
        if category:
            qs = qs.filter(category=category[:80])
        if term:
            qs = qs.filter(Q(name__icontains=term) | Q(email__icontains=term) | Q(subject__icontains=term))
        return qs.order_by("-created_at")

    def partial_update(self, request, *args, **kwargs):
        with transaction.atomic():
            try:
                instance = self.get_queryset().select_for_update().get(pk=kwargs["pk"])
            except ContactMessage.DoesNotExist as exc:
                raise NotFound("Mensaje de contacto no encontrado.") from exc
            serializer = self.get_serializer(instance, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            updated = serializer.save()
            # PostgreSQL trigger owns assigned_at/handled_at/updated_at.
            updated.refresh_from_db()
            self._audit("contact_message.updated", "contact_message", updated.pk, {
                "status": updated.status,
                "assigned": bool(updated.assigned_to),
                "notes_changed": "internal_notes" in serializer.validated_data,
            })
        return Response(self.get_serializer(updated).data)


class UserProfileAdminSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserProfile
        fields = (
            "id", "user_id", "email", "full_name", "role", "status", "created_at",
            "updated_at", "role_updated_at", "role_updated_by", "suspended_at",
            "suspended_by", "suspension_reason",
        )
        read_only_fields = (
            "id", "created_at", "updated_at", "role_updated_at", "role_updated_by",
            "suspended_at", "suspended_by",
        )

    def validate_user_id(self, value):
        if self.instance:
            if value != self.instance.user_id:
                raise serializers.ValidationError("No se puede cambiar la identidad Supabase de un perfil existente.")
            return value
        if not auth_user_exists(value):
            raise serializers.ValidationError("La identidad no existe en Supabase Auth.")
        return value

    def validate_email(self, value):
        value = value.strip()
        if value:
            duplicates = UserProfile.objects.annotate(normalized_email=Lower(Trim("email"))).filter(
                normalized_email=value.lower(),
            )
            if self.instance:
                duplicates = duplicates.exclude(pk=self.instance.pk)
            if duplicates.exists():
                raise serializers.ValidationError("Ya existe un perfil con ese correo electrónico.")
        return value

    def validate_role(self, value):
        actor_role = global_role(self.context["request"].user)
        if actor_role != "superadmin" and value in {"admin", "superadmin"}:
            raise serializers.ValidationError("Sólo un superadministrador puede asignar roles administrativos globales.")
        return value

    def validate_status(self, value):
        if value not in {"active", "suspended", "deleted"}:
            raise serializers.ValidationError("Estado de cuenta no válido.")
        actor_role = global_role(self.context["request"].user)
        target_role = getattr(self.instance, "role", None)
        if actor_role != "superadmin" and target_role in {"admin", "superadmin"}:
            raise serializers.ValidationError("Sólo un superadministrador puede modificar el estado de otro administrador global.")
        return value

    def validate_suspension_reason(self, value):
        return value.strip()[:4000]


class UserProfileAdminViewSet(GlobalAdminViewSet):
    queryset = UserProfile.objects.all()
    serializer_class = UserProfileAdminSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset().order_by("-created_at")
        role, state = self.request.query_params.get("role"), self.request.query_params.get("status")
        term = self.request.query_params.get("q", "").strip()[:160]
        if role:
            qs = qs.filter(role=role)
        if state:
            qs = qs.filter(status=state)
        if term:
            qs = qs.annotate(user_id_text=Cast("user_id", CharField())).filter(
                Q(email__icontains=term) | Q(full_name__icontains=term) | Q(user_id_text__icontains=term)
            )
        return qs

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            if serializer.validated_data.get("role", "teacher") in {"admin", "superadmin"} and global_role(request.user) != "superadmin":
                raise PermissionDenied("Sólo un superadministrador puede crear perfiles administrativos.")
            instance = serializer.save()
            instance.role_updated_by = request.user.id
            instance.role_updated_at = timezone.now()
            update_fields = ["role_updated_by", "role_updated_at"]
            if instance.status == "suspended":
                instance.suspended_at = timezone.now()
                instance.suspended_by = request.user.id
                update_fields.extend(["suspended_at", "suspended_by"])
            instance.save(update_fields=update_fields)
            self._audit("user_profile.created", "user_profile", instance.pk, {"role": instance.role})
        return Response(self.get_serializer(instance).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        with transaction.atomic():
            # Obtain the same transaction advisory lock used by the optional DB
            # trigger hardening before row locks. This lock order avoids deadlocks
            # when an administrator and a direct SQL maintenance task overlap.
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_xact_lock(%s, %s)", list(SUPERADMIN_GUARD_LOCK))
            # Then lock all active superadmins before changing role/status.
            list(UserProfile.objects.select_for_update().filter(role="superadmin", status="active").order_by("pk").values_list("pk", flat=True))
            try:
                instance = self.get_queryset().select_for_update().get(pk=kwargs["pk"])
            except UserProfile.DoesNotExist as exc:
                raise NotFound("Perfil de usuario no encontrado.") from exc
            previous_role, previous_status = instance.role, instance.status
            serializer = self.get_serializer(instance, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            next_role = serializer.validated_data.get("role", previous_role)
            next_status = serializer.validated_data.get("status", previous_status)
            if previous_role == "superadmin" and previous_status == "active" and (next_role != "superadmin" or next_status != "active"):
                remaining = UserProfile.objects.filter(role="superadmin", status="active").exclude(pk=instance.pk).count()
                if remaining == 0:
                    raise ValidationError({"status": "No se puede degradar ni suspender al último superadministrador activo."})
            if global_role(request.user) != "superadmin" and previous_role in {"admin", "superadmin"}:
                raise PermissionDenied("Sólo un superadministrador puede gestionar perfiles administrativos globales.")
            updated = serializer.save()
            if updated.role != previous_role:
                updated.role_updated_by = request.user.id
            if updated.status == "suspended":
                updated.suspended_by = request.user.id
            else:
                updated.suspended_by = None
                updated.suspension_reason = ""
            updated.save(update_fields=["role_updated_by", "suspended_by", "suspension_reason"])
            # The database trigger owns role_updated_at and suspended_at.
            updated.refresh_from_db()
            self._audit("user_profile.updated", "user_profile", updated.pk, {
                "role_changed": updated.role != previous_role,
                "status_changed": updated.status != previous_status,
                "role": updated.role,
                "status": updated.status,
            })
        return Response(self.get_serializer(updated).data)


class InstitutionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Institution
        fields = ("id", "name", "slug", "contact_email", "status", "created_by", "created_at", "updated_at", "updated_by")
        read_only_fields = ("id", "created_by", "created_at", "updated_at", "updated_by")


class InstitutionViewSet(viewsets.ModelViewSet):
    serializer_class = InstitutionSerializer
    queryset = Institution.objects.all()
    permission_classes = [IsAuthenticated]

    def _manager_memberships(self):
        return active_memberships(self.request.user, ["institution_admin", "department_admin"])

    def get_queryset(self):
        qs = Institution.objects.all()
        if global_role(self.request.user) in {"admin", "superadmin"}:
            return qs.order_by("name")
        institution_ids = self._manager_memberships().values_list("institution_id", flat=True)
        return qs.filter(pk__in=institution_ids).order_by("name")

    def _check_write(self, instance=None, partial_data=None):
        role = global_role(self.request.user)
        if role in {"admin", "superadmin"}:
            return role
        memberships = self._manager_memberships()
        if instance is None or not memberships.filter(institution_id=instance.pk, role="institution_admin").exists():
            raise PermissionDenied("No tenés permisos para administrar esta institución.")
        if partial_data and set(partial_data) - {"name", "contact_email"}:
            raise PermissionDenied("El administrador institucional sólo puede modificar nombre y correo de contacto.")
        return "institution_admin"

    def create(self, request, *args, **kwargs):
        role = self._check_write()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            obj = serializer.save(created_by=request.user.id, updated_by=request.user.id)
            _audit(request, "institution.created", "institution", obj.pk, {"status": obj.status})
        return Response(self.get_serializer(obj).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        return self._update_scoped(request, partial=False, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        return self._update_scoped(request, partial=True, **kwargs)

    def _update_scoped(self, request, partial, pk):
        with transaction.atomic():
            try:
                instance = self.get_queryset().select_for_update().get(pk=pk)
            except Institution.DoesNotExist as exc:
                raise NotFound("Institución no encontrada.") from exc
            self._check_write(instance, request.data)
            serializer = self.get_serializer(instance, data=request.data, partial=partial)
            serializer.is_valid(raise_exception=True)
            obj = serializer.save(updated_by=request.user.id)
            _audit(request, "institution.updated", "institution", obj.pk, {"status": obj.status})
        return Response(self.get_serializer(obj).data)

    def destroy(self, request, *args, **kwargs):
        with transaction.atomic():
            try:
                instance = self.get_queryset().select_for_update().get(pk=kwargs["pk"])
            except Institution.DoesNotExist as exc:
                raise NotFound("Institución no encontrada.") from exc
            self._check_write(instance)
            instance.status = "archived"
            instance.updated_by = request.user.id
            instance.save(update_fields=["status", "updated_by", "updated_at"])
            _audit(request, "institution.archived", "institution", instance.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


class InstitutionMembershipSerializer(serializers.ModelSerializer):
    class Meta:
        model = InstitutionMembership
        fields = ("id", "institution", "user_id", "role", "status", "invited_by", "created_at", "updated_at", "updated_by")
        read_only_fields = ("id", "created_at", "updated_at", "invited_by", "updated_by")

    def validate_institution(self, value):
        if value.status != "active":
            raise serializers.ValidationError("Sólo se pueden gestionar membresías de instituciones activas.")
        return value

    def validate_user_id(self, value):
        if self.instance and value != self.instance.user_id:
            raise serializers.ValidationError("No se puede cambiar la identidad de una membresía existente.")
        if not auth_user_exists(value):
            raise serializers.ValidationError("La identidad no existe en Supabase Auth.")
        return value

    def validate(self, attrs):
        institution = attrs.get("institution", getattr(self.instance, "institution", None))
        user_id = attrs.get("user_id", getattr(self.instance, "user_id", None))
        if institution and user_id:
            duplicate = InstitutionMembership.objects.filter(institution=institution, user_id=user_id)
            if self.instance:
                duplicate = duplicate.exclude(pk=self.instance.pk)
            if duplicate.exists():
                raise serializers.ValidationError({"user_id": "La persona ya tiene una membresía en esta institución."})
        return attrs


class InstitutionMembershipViewSet(viewsets.ModelViewSet):
    queryset = InstitutionMembership.objects.select_related("institution")
    serializer_class = InstitutionMembershipSerializer
    permission_classes = [IsAuthenticated]
    # Disallow PUT: the update contract deliberately uses the guarded PATCH path.
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        if global_role(self.request.user) in {"admin", "superadmin"}:
            return qs.order_by("-created_at")
        mine = active_memberships(self.request.user)
        manageable_ids = mine.filter(role="institution_admin").values_list("institution_id", flat=True)
        # Institution admins may list their institution's members. Department
        # admins and ordinary teachers see only their own membership: the schema
        # has no department_id with which to safely widen that scope.
        return qs.filter(
            Q(institution_id__in=manageable_ids) | Q(user_id=self.request.user.id)
        ).order_by("-created_at")

    def _authorize(self, institution, role=None, target_user=None):
        if global_role(self.request.user) in {"admin", "superadmin"}:
            return
        membership = active_memberships(self.request.user).filter(institution_id=institution.pk).first()
        if not membership or membership.role != "institution_admin":
            raise PermissionDenied("No tenés permisos para administrar las membresías de esta institución.")
        if role == "institution_admin":
            raise PermissionDenied("Sólo la administración global puede asignar administradores institucionales.")
        if target_user == self.request.user.id:
            raise PermissionDenied("No podés modificar tu propia membresía desde este endpoint.")

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        institution = serializer.validated_data["institution"]
        self._authorize(institution, serializer.validated_data.get("role"), serializer.validated_data.get("user_id"))
        with transaction.atomic():
            obj = serializer.save(invited_by=request.user.id, updated_by=request.user.id)
            _audit(request, "institution_membership.created", "institution_membership", obj.pk, {"institution_id": institution.pk, "role": obj.role})
        return Response(self.get_serializer(obj).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        with transaction.atomic():
            try:
                instance = self.get_queryset().select_for_update().get(pk=kwargs["pk"])
            except InstitutionMembership.DoesNotExist as exc:
                raise NotFound("Membresía no encontrada.") from exc
            data = request.data
            if "institution" in data and str(data["institution"]) != str(instance.institution_id):
                raise ValidationError({"institution": "No se puede mover una membresía entre instituciones."})
            self._authorize(instance.institution, data.get("role", instance.role), instance.user_id)
            serializer = self.get_serializer(instance, data=data, partial=True)
            serializer.is_valid(raise_exception=True)
            obj = serializer.save(updated_by=request.user.id)
            _audit(request, "institution_membership.updated", "institution_membership", obj.pk, {"role": obj.role, "status": obj.status})
        return Response(self.get_serializer(obj).data)

    def destroy(self, request, *args, **kwargs):
        with transaction.atomic():
            try:
                obj = self.get_queryset().select_for_update().get(pk=kwargs["pk"])
            except InstitutionMembership.DoesNotExist as exc:
                raise NotFound("Membresía no encontrada.") from exc
            self._authorize(obj.institution, obj.role, obj.user_id)
            obj.status = "suspended"
            obj.updated_by = request.user.id
            obj.save(update_fields=["status", "updated_by", "updated_at"])
            _audit(request, "institution_membership.suspended", "institution_membership", obj.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AIProviderConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = AIProviderConfig
        fields = ("id", "provider", "model_name", "enabled", "priority", "timeout_seconds", "input_usd_per_1k_tokens", "output_usd_per_1k_tokens", "updated_by", "updated_at")
        read_only_fields = ("id", "updated_by", "updated_at")

    def validate_timeout_seconds(self, value):
        if not 5 <= value <= 85:
            raise serializers.ValidationError("El timeout debe estar entre 5 y 85 segundos para respetar el máximo del adaptador de IA.")
        return value

    def validate_priority(self, value):
        if not -32768 <= value <= 32767:
            raise serializers.ValidationError("La prioridad está fuera del rango smallint.")
        return value

    def validate(self, attrs):
        for field in ("input_usd_per_1k_tokens", "output_usd_per_1k_tokens"):
            value = attrs.get(field)
            if value is not None and value < 0:
                raise serializers.ValidationError({field: "El costo no puede ser negativo."})
        provider = attrs.get("provider", getattr(self.instance, "provider", ""))
        enabled = attrs.get("enabled", getattr(self.instance, "enabled", False))
        model_name = attrs.get("model_name", getattr(self.instance, "model_name", ""))
        if enabled and provider == "openai" and not str(model_name or "").strip():
            raise serializers.ValidationError({"model_name": "Configurá un modelo OpenAI habilitado antes de activar este proveedor."})
        return attrs


def _confirmation_flag(value):
    return value is True or str(value).strip().lower() in {"true", "1", "on", "yes"}


class AIProviderConfigViewSet(viewsets.ModelViewSet):
    """Configuración de proveedores IA.

    Habilitar un proveedor externo envía respuestas de estudiantes a un tercero. Esa
    decisión exige rol superadmin y una confirmación explícita que queda auditada
    (AUD-012); no basta con cambiar una fila de la base desde cualquier cuenta admin.
    """
    queryset = AIProviderConfig.objects.all()
    serializer_class = AIProviderConfigSerializer
    permission_classes = [IsAuthenticated, IsGlobalAdmin]

    def _external_processing_gate(self, serializer):
        instance = serializer.instance
        data = serializer.validated_data
        provider = data.get("provider", getattr(instance, "provider", "mock"))
        enabled = data.get("enabled", getattr(instance, "enabled", False))
        model_name = data.get("model_name", getattr(instance, "model_name", ""))
        if not enabled or provider == "mock":
            return False
        was_same_enabled = bool(
            instance and instance.enabled and instance.provider == provider and instance.model_name == model_name
        )
        if was_same_enabled:
            # Ajustes de prioridad, timeout o costos de un proveedor ya aprobado.
            return False
        if global_role(self.request.user) != "superadmin":
            raise PermissionDenied("Sólo un superadministrador puede habilitar un proveedor de IA externo.")
        if not _confirmation_flag(self.request.data.get("confirm_external_processing")):
            raise ValidationError({
                "confirm_external_processing": (
                    "Confirmá que la institución autorizó enviar respuestas de estudiantes a este proveedor externo."
                )
            })
        return True

    def perform_create(self, serializer):
        confirmed = self._external_processing_gate(serializer)
        with transaction.atomic():
            obj = serializer.save(updated_by=self.request.user.id)
            _audit(self.request, "ai_provider_config.created", "ai_provider_config", obj.pk, {
                "provider": obj.provider, "enabled": obj.enabled, "model_name": obj.model_name,
                "external_processing_confirmed": confirmed,
            })

    def perform_update(self, serializer):
        confirmed = self._external_processing_gate(serializer)
        with transaction.atomic():
            obj = serializer.save(updated_by=self.request.user.id)
            _audit(self.request, "ai_provider_config.updated", "ai_provider_config", obj.pk, {
                "provider": obj.provider, "enabled": obj.enabled, "model_name": obj.model_name,
                "external_processing_confirmed": confirmed,
            })

    def destroy(self, request, *args, **kwargs):
        with transaction.atomic():
            obj = self.get_object()
            obj.enabled = False
            obj.updated_by = request.user.id
            obj.save(update_fields=["enabled", "updated_by", "updated_at"])
            _audit(request, "ai_provider_config.disabled", "ai_provider_config", obj.pk, {"provider": obj.provider})
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminAuditEventViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AuditEvent.objects.all()
    serializer_class = None
    permission_classes = [IsAuthenticated, IsGlobalAdmin]

    def get_queryset(self):
        qs = super().get_queryset().order_by("-created_at")
        event_type = self.request.query_params.get("event_type")
        object_type = self.request.query_params.get("object_type")
        actor = self.request.query_params.get("actor")
        owner = self.request.query_params.get("owner")
        if event_type:
            qs = qs.filter(event_type=event_type[:80])
        if object_type:
            qs = qs.filter(object_type=object_type[:80])
        if actor:
            try:
                from uuid import UUID
                actor = UUID(actor)
            except (TypeError, ValueError):
                raise ValidationError({"actor": "El filtro actor debe ser un UUID válido."})
            qs = qs.filter(actor_user_id=actor)
        if owner:
            try:
                from uuid import UUID
                owner = UUID(owner)
            except (TypeError, ValueError):
                raise ValidationError({"owner": "El filtro owner debe ser un UUID válido."})
            qs = qs.filter(owner_id=owner)
        return qs[:500]

    def get_serializer_class(self):
        return AuditEventSerializer


class AuditEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditEvent
        fields = ("id", "owner_id", "actor_user_id", "actor_role", "event_type", "object_type", "object_id", "detail", "request_id", "ip_address", "user_agent", "created_at")
