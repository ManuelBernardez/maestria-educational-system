"""Bounded pagination for API list endpoints."""
from __future__ import annotations

import os

from rest_framework.pagination import PageNumberPagination


def _positive_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return max(1, value)


DEFAULT_PAGE_SIZE = _positive_int("API_PAGE_SIZE", 20)
MAX_PAGE_SIZE = max(DEFAULT_PAGE_SIZE, _positive_int("API_MAX_PAGE_SIZE", 100))


class BoundedPageNumberPagination(PageNumberPagination):
    page_size = DEFAULT_PAGE_SIZE
    page_size_query_param = "page_size"
    max_page_size = MAX_PAGE_SIZE
