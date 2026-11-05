"""Compatibility facade for the domain-grouped API view modules.

Keep URL routing and external imports stable; implement new endpoints in
``api_views`` using the dashboard, catalog, and submissions boundaries.
"""

from .api_views.common import (
    OwnerViewSet,
    _read_document,
    _safe_ai_error_detail,
    active_ai_provider_config,
    clear_mock_practice_corrections,
    courses_with_dashboard_counts,
    fingerprint,
    record_ai_generation,
    record_audit,
)
from .api_views.dashboard import (
    audit_events,
    client_config,
    contact,
    correction_workspace,
    current_user_profile,
    dashboard_overview,
    dashboard_summary,
    health,
    seed_demo_dataset,
)

from .api_views.catalog import (
    AssessmentViewSet,
    CourseViewSet,
    EnrollmentViewSet,
    QuestionViewSet,
    RubricCriterionViewSet,
    RubricLevelViewSet,
    RubricViewSet,
    StudentViewSet,
)

from .api_views.submissions import (
    CorrectionViewSet,
    SubmissionAnswerViewSet,
    SubmissionViewSet,
    _serialize_correction,
)

