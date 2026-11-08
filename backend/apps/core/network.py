"""Identificación de la IP del cliente con el mismo criterio que los throttles de DRF.

`X-Forwarded-For` lo puede escribir el cliente: los proxies agregan su entrada al
final, pero no borran lo que ya venía. Por eso sólo se confía en las últimas
`REST_FRAMEWORK["NUM_PROXIES"]` entradas (las que agregan proxies propios), o en
`REMOTE_ADDR` cuando NUM_PROXIES es 0. Auditoría y límites de frecuencia usan esta
misma regla para que no exista una segunda forma de falsificar la IP.
"""
import ipaddress

from rest_framework.throttling import BaseThrottle


def client_ip(request):
    """IP del cliente según NUM_PROXIES, o None si el valor no es una IP válida.

    Reutiliza `BaseThrottle.get_ident` para que la auditoría identifique al cliente
    exactamente igual que los throttles. Acepta HttpRequest de Django o Request de DRF.
    """
    raw = BaseThrottle().get_ident(request)
    try:
        return str(ipaddress.ip_address((raw or "").strip()))
    except ValueError:
        return None


def _kind(value):
    try:
        address = ipaddress.ip_address(value.strip())
    except ValueError:
        return "invalida"
    if address.is_private or address.is_loopback or address.is_link_local:
        return "privada"
    return "publica"


def proxy_header_shape(request):
    """Forma de los headers de proxy sin registrar ninguna IP (diagnóstico temporal).

    Indica cuántas entradas trae X-Forwarded-For, si cada una es pública o privada y en
    qué posición, contada desde el final, aparece la IP que informan True-Client-IP o
    CF-Connecting-IP. Si esa posición es -2, NUM_PROXIES debe ser 2.
    """
    meta = request.META
    forwarded = [item.strip() for item in meta.get("HTTP_X_FORWARDED_FOR", "").split(",") if item.strip()]

    def position(header):
        value = meta.get(header, "").strip()
        if not value:
            return "ausente"
        for offset in range(1, len(forwarded) + 1):
            if forwarded[-offset] == value:
                return f"-{offset}"
        return "no_esta_en_xff"

    return {
        "remote_addr": _kind(meta.get("REMOTE_ADDR", "")),
        "xff_entradas": len(forwarded),
        "xff_tipos": [_kind(item) for item in forwarded],
        "true_client_ip_en_xff": position("HTTP_TRUE_CLIENT_IP"),
        "cf_connecting_ip_en_xff": position("HTTP_CF_CONNECTING_IP"),
    }
