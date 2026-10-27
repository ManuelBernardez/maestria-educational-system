from rest_framework.permissions import BasePermission

class IsOwner(BasePermission):
    def has_object_permission(self, request, view, obj):
        return str(getattr(obj, "owner_id", "")) == str(request.user.id)
