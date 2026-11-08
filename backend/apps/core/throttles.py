from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class AIUserRateThrottle(UserRateThrottle):
    scope = "ai"


class ContactRateThrottle(AnonRateThrottle):
    scope = "contact"


class ContactUserRateThrottle(UserRateThrottle):
    """Cupo de contacto para usuarios con sesión.

    A los anónimos los limita ContactRateThrottle. Si este throttle también los
    contara, ambos usarían la misma clave (`throttle_contact_<ip>`) y cada mensaje
    se registraría dos veces: el límite de 5/hora pasaría a ser 2 o 3 en la práctica.
    """

    scope = "contact"

    def get_cache_key(self, request, view):
        user = getattr(request, "user", None)
        if not (user and getattr(user, "is_authenticated", False)):
            return None
        return super().get_cache_key(request, view)
