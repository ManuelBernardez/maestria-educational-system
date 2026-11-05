from types import SimpleNamespace

from rest_framework.permissions import BasePermission

from .models import InstitutionMembership, UserProfile


def active_profile(user):
    if not user or not getattr(user, "is_authenticated", False):
        return None
    # Authentication attaches verified, per-request metadata. Reusing it avoids
    # a redundant SELECT on every protected API call.
    role = getattr(user, "role", "")
    status = getattr(user, "profile_status", "")
    if role and status:
        return SimpleNamespace(role=role, status=status) if status == "active" else None
    return UserProfile.objects.filter(user_id=user.id, status="active").only("role", "status").first()


def global_role(user):
    profile = active_profile(user)
    return profile.role if profile else None


def is_global_admin(user):
    return global_role(user) in {"admin", "superadmin"}


def active_memberships(user, roles=None):
    qs = InstitutionMembership.objects.filter(
        user_id=user.id, status="active", institution__status="active",
    )
    return qs.filter(role__in=roles) if roles else qs


class IsOwner(BasePermission):
    def has_object_permission(self, request, view, obj):
        return str(getattr(obj, "owner_id", "")) == str(request.user.id)


class IsWorkspaceUser(BasePermission):
    message = "Tu rol no tiene acceso al espacio docente."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if not user or not getattr(user, "is_authenticated", False):
            return False
        profile = active_profile(user)
        # Fail closed: the auth.users -> user_profile trigger provisions every
        # valid identity. A missing profile must never imply a teacher role.
        return bool(profile and profile.role in {"teacher", "admin", "superadmin"})


class IsGlobalAdmin(BasePermission):
    message = "Se requiere un rol de administración global activo."

    def has_permission(self, request, view):
        return is_global_admin(getattr(request, "user", None))
