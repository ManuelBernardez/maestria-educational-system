from django.core.cache import caches
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle

from .client_ip import client_ip


class ClientIPMixin:
    """Identifica anónimos por la IP real (no por `X-Forwarded-For`, falsificable)."""

    def get_ident(self, request):
        return client_ip(request) or "unknown"


class SharedCacheMixin:
    """Contadores en la caché compartida (DB): valen para todos los workers y deploys.

    Sólo para límites de bajo volumen y alto costo (IA, contacto); los límites
    generales siguen en memoria para no sumar consultas a cada request.
    """

    @property
    def cache(self):
        return caches["shared"]


class MaestriaAnonRateThrottle(ClientIPMixin, AnonRateThrottle):
    pass


class MaestriaUserRateThrottle(ClientIPMixin, UserRateThrottle):
    pass


class AIUserRateThrottle(SharedCacheMixin, ClientIPMixin, UserRateThrottle):
    scope = "ai"


class ContactRateThrottle(SharedCacheMixin, ClientIPMixin, AnonRateThrottle):
    scope = "contact"


class ContactUserRateThrottle(SharedCacheMixin, ClientIPMixin, UserRateThrottle):
    scope = "contact"
