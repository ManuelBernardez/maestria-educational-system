from django.urls import path
from rest_framework.routers import DefaultRouter
from .views import (
    AssessmentViewSet, CourseViewSet, EnrollmentViewSet, QuestionViewSet,
    RubricCriterionViewSet, RubricLevelViewSet, RubricViewSet, StudentViewSet,
    SubmissionAnswerViewSet, SubmissionViewSet, CorrectionViewSet,
    audit_events, contact, correction_workspace, dashboard_summary, seed_demo_dataset,
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

urlpatterns = [
    path("dashboard/summary/", dashboard_summary, name="dashboard-summary"),
    path("correction-workspace/", correction_workspace, name="correction-workspace"),
    path("demo/seed/", seed_demo_dataset, name="demo-seed"),
    path("audit-events/", audit_events, name="audit-events"),
    path("contact/", contact, name="contact"),
] + router.urls
