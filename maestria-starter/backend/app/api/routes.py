from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException
from app.core.auth import current_user
from app.core.config import get_settings
from app.schemas.ai import CorrectionRequest, CorrectionResponse
from app.services.ai_provider import AIProviderError, propose_correction

router = APIRouter()


@router.get("/health")
async def health():
    return {"status": "ok", "service": "maestria-api"}


@router.get("/me")
async def me(user: Annotated[dict, Depends(current_user)]):
    return user


@router.post("/corrections/proposal", response_model=CorrectionResponse)
async def create_correction_proposal(
    request: CorrectionRequest,
    user: Annotated[dict, Depends(current_user)],
):
    """Scaffold endpoint: authenticated AI proposal; persistence/history is the next milestone."""
    settings = get_settings()
    if len(request.student_response) > settings.max_input_chars:
        raise HTTPException(status_code=413, detail="La respuesta supera el límite permitido")
    try:
        proposal = await propose_correction(request)
    except AIProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return CorrectionResponse(proposal=proposal, requires_teacher_review=True)
