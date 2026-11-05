import os
from dataclasses import dataclass
from functools import lru_cache
from uuid import UUID

from django.db import DatabaseError
from jwt import PyJWKClient, decode, get_unverified_header, InvalidTokenError
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed

from .models import UserProfile


@dataclass
class SupabasePrincipal:
    id: str
    email: str = ""
    role: str = ""
    profile_status: str = ""
    is_authenticated: bool = True
    is_anonymous: bool = False

    @property
    def pk(self):
        return self.id


@lru_cache(maxsize=4)
def _jwks_client(url):
    return PyJWKClient(url, timeout=5, cache_keys=True, max_cached_keys=16, lifespan=300)


def _principal_from_claims(claims):
    if claims.get("role") != "authenticated" or claims.get("is_anonymous") is True:
        raise InvalidTokenError("Token is not an authenticated user access token")
    user_id = claims.get("sub")
    if not user_id:
        raise InvalidTokenError("Missing subject")
    return SupabasePrincipal(id=str(UUID(str(user_id))), email=claims.get("email") or "")


class SupabaseJWTAuthentication(BaseAuthentication):
    """Validate Supabase JWT and reject disabled MaestrIA profiles."""

    def authenticate(self, request):
        parts = get_authorization_header(request).split()
        if not parts:
            return None
        if parts[0].lower() != b"bearer" or len(parts) != 2:
            raise AuthenticationFailed("Formato de autenticación inválido.")
        supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
        if not supabase_url:
            raise AuthenticationFailed("La autenticación no está configurada en el servidor.")
        if len(parts[1]) > 16_384:
            raise AuthenticationFailed("Token de autenticación demasiado grande.")
        try:
            token = parts[1].decode("utf-8")
            header = get_unverified_header(token)
            if header.get("alg") == "HS256" and os.getenv("SUPABASE_JWT_SECRET"):
                claims = decode(
                    token, os.getenv("SUPABASE_JWT_SECRET"), algorithms=["HS256"],
                    audience="authenticated", options={"require": ["exp", "sub"]},
                    issuer=f"{supabase_url}/auth/v1",
                )
            else:
                key = _jwks_client(f"{supabase_url}/auth/v1/.well-known/jwks.json").get_signing_key_from_jwt(token).key
                claims = decode(
                    token, key, algorithms=["ES256", "RS256"], audience="authenticated",
                    options={"require": ["exp", "sub"]}, issuer=f"{supabase_url}/auth/v1",
                )
            principal, raw_token = _principal_from_claims(claims), token
        except Exception as exc:
            raise AuthenticationFailed("Token inválido o vencido.") from exc

        # Intentionally outside token-validation try/except: a database outage
        # must be reported as a server failure, not mislabeled as an invalid JWT.
        try:
            profile = UserProfile.objects.filter(user_id=principal.id).only("role", "status").first()
        except DatabaseError:
            raise
        # The schema trigger provisions a teacher profile for every Auth user.
        # Missing authorization metadata is therefore a provisioning failure,
        # not a reason to grant the default teacher permissions.
        if profile is None:
            raise AuthenticationFailed("La cuenta todavía no tiene un perfil de acceso en MaestrIA.")
        if profile.status != "active":
            raise AuthenticationFailed("La cuenta de MaestrIA está suspendida o deshabilitada.")
        # Cache only non-sensitive authorization metadata on this request's
        # principal. Permissions reuse it instead of issuing a second profile query.
        principal.role = profile.role
        principal.profile_status = profile.status
        return principal, raw_token

    def authenticate_header(self, request):
        return "Bearer"
