"""IP real del cliente detrás de Cloudflare + proxy de Render (AUD-005).

Render agrega su IP a `X-Forwarded-For` sin limpiar el valor que manda el cliente,
así que esa cabecera es falsificable y no se usa. En producción todo el tráfico de
`*.onrender.com` entra por Cloudflare, que sobrescribe `True-Client-IP` y
`CF-Connecting-IP` con la IP que vio en su borde. Las cabeceras confiables se
configuran con `TRUSTED_CLIENT_IP_HEADERS` (vacío en desarrollo).
"""
import ipaddress

from django.conf import settings


def _meta_key(header_name):
    return "HTTP_" + header_name.strip().upper().replace("-", "_")


def _valid_ip(value):
    candidate = str(value or "").strip()
    if not candidate or len(candidate) > 64:
        return None
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return None


def client_ip(request):
    """Devuelve la IP del cliente o None. Acepta HttpRequest o Request de DRF."""
    meta = getattr(request, "META", {}) or {}
    for header in getattr(settings, "TRUSTED_CLIENT_IP_HEADERS", ()):
        ip = _valid_ip(meta.get(_meta_key(header)))
        if ip:
            return ip
    return _valid_ip(meta.get("REMOTE_ADDR"))
