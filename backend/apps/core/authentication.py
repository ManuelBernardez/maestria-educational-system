import os
from dataclasses import dataclass
from functools import lru_cache
from uuid import UUID
from jwt import PyJWKClient, decode, InvalidTokenError, get_unverified_header
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed

@dataclass
class SupabasePrincipal:
    id: str
    email: str = ""
    is_authenticated: bool = True
    is_anonymous: bool = False

    @property
    def pk(self):
        # DRF's UserRateThrottle expects request.user.pk. This principal is not
        # a Django ORM User, so expose the verified Supabase subject explicitly.
        return self.id

@lru_cache(maxsize=4)
def _jwks_client(url):
    # Bound outbound key-discovery latency and cache key sets across requests.
    # A transient Supabase/JWKS outage must not pin a Gunicorn worker for 30s.
    return PyJWKClient(url, timeout=5, cache_keys=True, max_cached_keys=16, lifespan=300)


def _principal_from_claims(claims):
    """Accept only a real, non-anonymous Supabase Auth user principal."""
    if claims.get("role") != "authenticated":
        raise InvalidTokenError("Token is not an authenticated user access token")
    if claims.get("is_anonymous") is True:
        raise InvalidTokenError("Anonymous sessions are not allowed")
    user_id = claims.get("sub")
    if not user_id:
        raise InvalidTokenError("Missing subject")
    # owner_id is a UUID in PostgreSQL. Reject malformed subjects as auth errors
    # rather than leaking a database conversion failure as a 500 response.
    user_id = str(UUID(str(user_id)))
    return SupabasePrincipal(id=user_id, email=claims.get("email") or "")


class SupabaseJWTAuthentication(BaseAuthentication):
    """Validates Supabase access tokens. Configure SUPABASE_URL; no client-supplied owner IDs are trusted."""
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
                claims = decode(token, os.getenv("SUPABASE_JWT_SECRET"), algorithms=["HS256"], audience="authenticated", options={"require": ["exp", "sub"]}, issuer=f"{supabase_url}/auth/v1")
            else:
                jwks_url = f"{supabase_url}/auth/v1/.well-known/jwks.json"
                signing_key = _jwks_client(jwks_url).get_signing_key_from_jwt(token).key
                claims = decode(token, signing_key, algorithms=["ES256", "RS256"], audience="authenticated", options={"require": ["exp", "sub"]}, issuer=f"{supabase_url}/auth/v1")
            return _principal_from_claims(claims), token
        except Exception as exc:
            raise AuthenticationFailed("Token inválido o vencido.") from exc

    def authenticate_header(self, request):
        return "Bearer"
