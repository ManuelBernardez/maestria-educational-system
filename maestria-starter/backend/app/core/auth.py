from typing import Annotated
import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from app.core.config import get_settings

bearer = HTTPBearer(auto_error=False)


async def current_user(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
    """Validate a Supabase access token by asking Supabase Auth for the current user.

    This keeps JWT verification delegated to the configured auth service for the scaffold.
    For production, evaluate local JWKS verification to avoid an extra network request per API call.
    """
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Autenticación requerida")
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise HTTPException(status_code=503, detail="Autenticación no configurada")
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(
                f"{settings.supabase_url.rstrip('/')}/auth/v1/user",
                headers={"Authorization": f"Bearer {credentials.credentials}", "apikey": settings.supabase_anon_key},
            )
        if response.status_code != 200:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sesión inválida o vencida")
        user = response.json()
        if not user.get("id"):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Identidad inválida")
        return {"id": user["id"], "email": user.get("email")}
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="No se pudo validar la sesión") from exc
