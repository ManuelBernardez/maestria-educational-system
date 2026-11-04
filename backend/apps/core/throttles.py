from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class AIUserRateThrottle(UserRateThrottle):
    scope = "ai"


class ContactRateThrottle(AnonRateThrottle):
    scope = "contact"


class ContactUserRateThrottle(UserRateThrottle):
    scope = "contact"
