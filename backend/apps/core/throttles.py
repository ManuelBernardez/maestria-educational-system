from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class AIUserRateThrottle(UserRateThrottle):
    """Limit paid/slow AI generation requests per authenticated user."""
    scope = "ai"


class ContactRateThrottle(AnonRateThrottle):
    """Rate limit the public contact form without constraining health checks."""
    scope = "contact"
