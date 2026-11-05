#!/usr/bin/env python3
"""Static contract checks for the teacher's main end-to-end workflow."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
FRONT = ROOT / "frontend/js/modules"
BACK = ROOT / "backend/apps/core"

checks = {
    "create course": (FRONT / "features/forms.js", "api.post('courses/'"),
    "create student and enroll": (FRONT / "features/forms.js", "api.post('students/'"),
    "CSV student import": (FRONT / "features/forms.js", "students/import-csv/"),
    "create assessment": (FRONT / "features/forms.js", "api.post('assessments/'"),
    "create question": (FRONT / "features/forms.js", "api.post('questions/'"),
    "create text submission": (FRONT / "features/forms.js", "api.post('submissions/'"),
    "upload submission file": (FRONT / "features/forms.js", "submissions/import-file/"),
    "generate AI correction": (FRONT / "features/forms.js", "generate-correction/"),
    "approve correction": (FRONT / "features/forms.js", "corrections/${correction.id}/approve/"),
    "share approved correction": (FRONT / "features/share.js", "correction.status !== 'approved'"),
}
errors = []
for label, (path, needle) in checks.items():
    if not path.is_file() or needle not in path.read_text(encoding="utf-8"):
        errors.append(f"Frontend missing workflow stage: {label}")

backend_checks = {
    "course API": (BACK / "api_views/catalog.py", "class CourseViewSet"),
    "student API": (BACK / "api_views/catalog.py", "class StudentViewSet"),
    "assessment API": (BACK / "api_views/catalog.py", "class AssessmentViewSet"),
    "question API": (BACK / "api_views/catalog.py", "class QuestionViewSet"),
    "submission API": (BACK / "api_views/submissions.py", "class SubmissionViewSet"),
    "AI correction API": (BACK / "api_views/submissions.py", "def generate_correction_action"),
    "approval API": (BACK / "api_views/submissions.py", "def approve("),
}
for label, (path, needle) in backend_checks.items():
    if not path.is_file() or needle not in path.read_text(encoding="utf-8"):
        errors.append(f"Backend missing workflow stage: {label}")

urls = (BACK / "urls.py").read_text(encoding="utf-8")
for endpoint in ('"courses"', '"students"', '"assessments"', '"questions"', '"submissions"', '"corrections"'):
    if endpoint not in urls:
        errors.append(f"API router missing resource: {endpoint}")

if errors:
    print("\n".join(errors), file=sys.stderr)
    raise SystemExit(1)
print("OK: main teacher workflow has matching frontend actions and backend resources/actions.")
