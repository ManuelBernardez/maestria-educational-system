"""Pruebas puras (sin base de datos) de la validación tolerante de evidencia literal."""
from .ai import _validate_proposal, evidence_in_text, locate_evidence

SOURCE = "El  estudiante dijo:\nla “fotosíntesis” es un proceso — clave.\r\nOtra línea."


def test_exact_and_whitespace_tolerant_match():
    assert locate_evidence("Otra línea.", SOURCE) == "Otra línea."
    assert locate_evidence("estudiante dijo: la", SOURCE) == "estudiante dijo:\nla"


def test_typographic_quotes_and_dashes_are_tolerated():
    found = locate_evidence('la "fotosíntesis" es un proceso - clave.', SOURCE)
    assert found == "la “fotosíntesis” es un proceso — clave."


def test_invented_quotes_are_rejected():
    assert locate_evidence("texto inventado", SOURCE) == ""
    assert evidence_in_text("texto inventado", SOURCE) is False
    assert evidence_in_text("", SOURCE) is True


def test_validate_proposal_keeps_exact_source_text_and_warns():
    result = _validate_proposal(
        {"criteria": [{"criterion": "A", "score": 5, "max_score": 10, "evidence": "proceso  clave"}]},
        [{"name": "A", "max_score": 10}], 10, "un proceso\n clave. fin",
    )
    assert result["criteria"][0]["evidence"] == "proceso\n clave"
    assert any("ajustó" in warning for warning in result["warnings"])
