"""Delivery adapters. Only approved corrections may be sent."""
import os
import httpx
from django.conf import settings
from django.core.mail import send_mail
from rest_framework.exceptions import ValidationError, APIException

class IntegrationNotConfigured(APIException):
    status_code = 503
    default_detail = "La integración no está configurada."
    default_code = "integration_not_configured"

def _approved_content(correction):
    if correction.status != "approved" or not correction.approved_at:
        raise ValidationError("Solo se pueden enviar correcciones aprobadas por el docente.")
    submission = correction.submission
    student_name = submission.student.name if submission.student else submission.student_name or "Estudiante"
    data = correction.final_result or {}
    if data.get("demo"):
        raise ValidationError("No se pueden enviar propuestas simuladas. Conectá un proveedor de IA real y generá una nueva corrección.")
    lines = [f"Devolución de MaestrIA — {submission.assessment.title}", f"Estudiante: {student_name}", f"Puntaje final: {correction.total_score}", "", "Criterios:"]
    for item in data.get("criteria", []):
        lines.append(f"- {item.get('criterion', 'Criterio')}: {item.get('score', 0)}/{item.get('max_score', 0)}. {item.get('justification', '')}")
    lines.extend(["", "Retroalimentación:", correction.teacher_feedback or data.get("feedback", "")])
    return student_name, "\n".join(lines)

def send_correction_email(correction):
    _, body = _approved_content(correction)
    student = correction.submission.student
    recipient = student.email if student else ""
    if not recipient:
        raise ValidationError("La entrega no tiene un alumno asociado con correo electrónico.")
    if not settings.EMAIL_HOST or not settings.DEFAULT_FROM_EMAIL:
        raise IntegrationNotConfigured("Configurá SMTP y DEFAULT_FROM_EMAIL en el backend.")
    send_mail(f"Devolución: {correction.submission.assessment.title}", body, settings.DEFAULT_FROM_EMAIL, [recipient], fail_silently=False)
    return {"channel": "email", "status": "sent"}

def send_correction_whatsapp(correction):
    _, body = _approved_content(correction)
    student = correction.submission.student
    recipient = student.phone if student else ""
    if not recipient:
        raise ValidationError("La entrega no tiene un alumno asociado con teléfono.")
    if os.getenv("WHATSAPP_ENABLED", "False").lower() != "true":
        raise IntegrationNotConfigured("WhatsApp está deshabilitado. Activá WHATSAPP_ENABLED y configurá la API oficial de Meta.")
    token = os.getenv("WHATSAPP_ACCESS_TOKEN", "")
    phone_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "")
    version = os.getenv("WHATSAPP_API_VERSION", "v22.0")
    if not token or not phone_id:
        raise IntegrationNotConfigured("Faltan WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID.")
    # El número debe estar normalizado con código de país, sin + ni espacios.
    recipient = "".join(ch for ch in recipient if ch.isdigit())
    if len(recipient) < 8:
        raise ValidationError("El teléfono no parece estar en formato internacional.")
    payload = {"messaging_product": "whatsapp", "recipient_type": "individual", "to": recipient, "type": "text", "text": {"preview_url": False, "body": body[:4000]}}
    with httpx.Client(timeout=20) as client:
        response = client.post(f"https://graph.facebook.com/{version}/{phone_id}/messages", headers={"Authorization": f"Bearer {token}"}, json=payload)
        if response.is_error:
            raise APIException("El proveedor de WhatsApp rechazó el envío. Revisá configuración, permisos y políticas de Meta.")
        result = response.json()
    return {"channel": "whatsapp", "status": "submitted", "provider_message_id": (result.get("messages") or [{}])[0].get("id")}
