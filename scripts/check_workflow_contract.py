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


workspace_checks = {
    "workspace summary endpoint": (FRONT / "features/workspace.js", "correction-workspace/?${params.toString()}"),
    "save workspace context": (FRONT / "features/workspace.js", "api.patch(`assessments/${assessment.id}/`"),
    "import reference material": (FRONT / "features/workspace.js", "assessments/${assessment.id}/import-reference/"),
    "generate question suggestions": (FRONT / "features/workspace.js", "assessments/${assessment.id}/generate-questions/"),
    "create suggested question": (FRONT / "features/workspace.js", "api.post('questions/'"),
    "import answer file": (FRONT / "features/workspace.js", "submissions/import-file/"),
    "create or update text submission": (FRONT / "features/workspace.js", "api.patch(`submissions/${workspace.activeSubmission.id}/`"),
    "generate workspace correction": (FRONT / "features/workspace.js", "submissions/${submission.id}/generate-correction/"),
    "approve workspace correction": (FRONT / "features/workspace.js", "corrections/${correction.id}/approve/"),
    "export workspace correction": (FRONT / "features/workspace.js", "corrections/${workspace.correction.id}/export/"),
}
for label, (path, needle) in workspace_checks.items():
    if not path.is_file() or needle not in path.read_text(encoding="utf-8"):
        errors.append(f"Workspace missing contract stage: {label}")

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


route_checks = {
    "workspace view in role router": (FRONT / "core/router.js", "'dashboard', 'workspace'"),
    "workspace view renderer": (FRONT / "app.js", "workspace: renderWorkspace"),
    "workspace view loads its own data": (FRONT / "data/resources.js", "correction-workspace/"),
}
for label, (path, needle) in route_checks.items():
    if not path.is_file() or needle not in path.read_text(encoding="utf-8"):
        errors.append(f"Frontend missing workspace integration: {label}")

urls = (BACK / "urls.py").read_text(encoding="utf-8")
for endpoint in ('"courses"', '"students"', '"assessments"', '"questions"', '"submissions"', '"corrections"'):
    if endpoint not in urls:
        errors.append(f"API router missing resource: {endpoint}")

if errors:
    print("\n".join(errors), file=sys.stderr)
    raise SystemExit(1)
print("OK: main teacher workflow has matching frontend actions and backend resources/actions.")
