import json
import httpx
from app.core.config import get_settings
from app.schemas.ai import CorrectionProposal, CorrectionRequest


class AIProviderError(RuntimeError):
    pass


async def propose_correction(payload: CorrectionRequest) -> CorrectionProposal:
    """Generate a *proposal* only. The teacher must review and approve the final result."""
    settings = get_settings()
    if not settings.ai_api_key or not settings.ai_model:
        raise AIProviderError("El proveedor de IA no está configurado")
    prompt = {
        "role": "user",
        "content": (
            "Evaluá la respuesta usando exclusivamente la consigna y la rúbrica. "
            "No inventes evidencia. Si falta evidencia, explicitalo. Respondé únicamente JSON con "
            "esta estructura: {criteria:[{criterion_id,score,rationale,evidence:[]}], "
            "total_score,overall_feedback,caveats:[]}. La puntuación total es una propuesta; "
            "el docente decide la nota final.\n\n"
            + json.dumps(payload.model_dump(), ensure_ascii=False)
        ),
    }
    body = {
        "model": settings.ai_model,
        "messages": [
            {"role": "system", "content": "Sos un asistente de evaluación educativa. La decisión final corresponde al docente."},
            prompt,
        ],
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    }
    try:
        async with httpx.AsyncClient(timeout=settings.ai_timeout_seconds) as client:
            response = await client.post(
                f"{settings.ai_base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {settings.ai_api_key}"},
                json=body,
            )
            response.raise_for_status()
            raw = response.json()["choices"][0]["message"]["content"]
            return CorrectionProposal.model_validate_json(raw)
    except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
        raise AIProviderError("No se pudo generar una propuesta válida de corrección") from exc
