from django.urls import path
from rest_framework.routers import DefaultRouter
from .admin_api import (
    AdminAuditEventViewSet, AIProviderConfigViewSet, ContactMessageAdminViewSet,
    InstitutionMembershipViewSet, InstitutionViewSet, UserProfileAdminViewSet,
)
from .views import (
    AssessmentViewSet, CourseViewSet, EnrollmentViewSet, QuestionViewSet,
    RubricCriterionViewSet, RubricLevelViewSet, RubricViewSet, StudentViewSet,
    SubmissionAnswerViewSet, SubmissionViewSet, CorrectionViewSet,
    audit_events, client_config, contact, correction_workspace, current_user_avatar, current_user_profile, dashboard_overview, dashboard_summary, seed_demo_dataset,
)

router = DefaultRouter()
router.register("courses", CourseViewSet)
router.register("enrollments", EnrollmentViewSet)
router.register("assessments", AssessmentViewSet)
router.register("students", StudentViewSet)
router.register("rubrics", RubricViewSet)
router.register("rubric-criteria", RubricCriterionViewSet)
router.register("rubric-levels", RubricLevelViewSet)
router.register("questions", QuestionViewSet)
router.register("submissions", SubmissionViewSet)
router.register("submission-answers", SubmissionAnswerViewSet)
router.register("corrections", CorrectionViewSet)
router.register("admin/contact-messages", ContactMessageAdminViewSet, basename="admin-contact-message")
router.register("admin/users", UserProfileAdminViewSet, basename="admin-user-profile")
router.register("admin/institutions", InstitutionViewSet, basename="admin-institution")
router.register("admin/institution-memberships", InstitutionMembershipViewSet, basename="admin-institution-membership")
router.register("admin/ai-providers", AIProviderConfigViewSet, basename="admin-ai-provider")
router.register("admin/audit-events", AdminAuditEventViewSet, basename="admin-audit-event")

urlpatterns = [
    path("client-config/", client_config, name="client-config"),
    path("me/", current_user_profile, name="current-user-profile"),
    path("me/avatar/", current_user_avatar, name="current-user-avatar"),
    path("dashboard/overview/", dashboard_overview, name="dashboard-overview"),
    path("dashboard/summary/", dashboard_summary, name="dashboard-summary"),
    path("correction-workspace/", correction_workspace, name="correction-workspace"),
    path("demo/seed/", seed_demo_dataset, name="demo-seed"),
    path("audit-events/", audit_events, name="audit-events"),
    path("contact/", contact, name="contact"),
] + router.urls
