from pydantic import BaseModel, Field


class CriterionProposal(BaseModel):
    criterion_id: str
    score: float = Field(ge=0)
    rationale: str
    evidence: list[str] = Field(default_factory=list)


class CorrectionProposal(BaseModel):
    criteria: list[CriterionProposal]
    total_score: float = Field(ge=0)
    overall_feedback: str
    caveats: list[str] = Field(default_factory=list)


class CorrectionRequest(BaseModel):
    question: str = Field(min_length=1, max_length=10000)
    student_response: str = Field(min_length=1, max_length=30000)
    rubric: list[dict] = Field(min_length=1)


class CorrectionResponse(BaseModel):
    proposal: CorrectionProposal
    requires_teacher_review: bool = True
