"""Observaciones sobre el contexto que el docente le da a la IA.

Las propuestas de consignas, rúbricas y correcciones son tan específicas como el
contexto que reciben. Este módulo revisa ese contexto con reglas simples (sin llamar
a ningún modelo ni consumir cuota) y devuelve avisos con una sugerencia concreta de
qué agregar o cómo redactarlo. Nunca bloquea: el docente decide.
"""
import re
import unicodedata

# Verbos que describen desempeños observables (en infinitivo o en subjuntivo de
# «que el estudiante…»). Sin al menos uno, un objetivo suele ser un tema, no un logro.
_OBSERVABLE_VERBS = (
    "analiz", "aplic", "argument", "calcul", "caracteriz", "clasific", "compar", "comprend",
    "construy", "constru", "describ", "diferenci", "disen", "distingu", "elabor", "evalu",
    "explic", "fundament", "identific", "interpret", "justific", "ordene", "orden", "planific",
    "produc", "produzc", "propon", "reconoc", "relacion", "represent", "resolv", "resuelv",
    "sintetiz", "utiliz", "valor", "formul", "demostr", "infer", "program", "implement",
    "argumen", "redact", "investig", "integr", "contrast", "examin", "seleccion",
)
_GENERIC_LEVEL_TEXTS = {
    "requiere apoyo para demostrar el criterio.",
    "demuestra parte de lo esperado.",
    "cumple el criterio esperado.",
    "demuestra el criterio con profundidad o transferencia.",
}
MIN_OBJECTIVE_WORDS = 12
MIN_INSTRUCTION_WORDS = 8


def _plain(text: str) -> str:
    text = unicodedata.normalize("NFKD", str(text or "").lower())
    return "".join(char for char in text if not unicodedata.combining(char))


def _words(text: str) -> list[str]:
    return re.findall(r"[a-záéíóúüñ0-9]+", str(text or "").lower())


def _has_observable_verb(text: str) -> bool:
    words = (re.sub(r"[^a-z]", "", word) for word in _plain(text).split())
    return any(len(word) > 3 and word.startswith(_OBSERVABLE_VERBS) for word in words)


def _note(code, severity, field, message, suggestion):
    return {"code": code, "severity": severity, "field": field, "message": message, "suggestion": suggestion}


def assess_context(assessment, questions=None, rubrics=None) -> list[dict]:
    """Avisos sobre el contexto de una evaluación, del más importante al menos.

    `questions`: consignas de la evaluación (con `prompt`, `expected_answer`, `rubric_id`).
    `rubrics`: rúbricas que el docente puede usar para corregir (con criterios y niveles
    precargados), o None si no se quiere revisar ese aspecto.
    """
    notes = []
    objectives = (assessment.objectives or "").strip()
    instructions = (assessment.instructions or "").strip()
    material = (assessment.reference_material or "").strip()
    questions = list(questions or [])

    if not objectives:
        notes.append(_note(
            "objectives_missing", "warning", "objectives",
            "Agregá los objetivos de aprendizaje",
            "Sin objetivos, la IA no sabe qué priorizar y las consignas y devoluciones salen genéricas. "
            "Escribí 2 o 3 objetivos con verbos observables, por ejemplo: «Que el estudiante compare… y justifique… con ejemplos del material».",
        ))
    else:
        if len(_words(objectives)) < MIN_OBJECTIVE_WORDS:
            notes.append(_note(
                "objectives_short", "info", "objectives",
                "Ampliá los objetivos",
                "Detallá qué tiene que poder hacer el estudiante y con qué contenidos: "
                "«Que el estudiante explique las causas de…, relacione… y lo aplique a un caso».",
            ))
        if not _has_observable_verb(objectives):
            notes.append(_note(
                "objectives_not_observable", "info", "objectives",
                "Redactá los objetivos como desempeños observables",
                "Redactalos con verbos que se puedan observar en una respuesta escrita (explicar, comparar, justificar, resolver, analizar) "
                "en lugar de «conocer» o «entender».",
            ))

    if not instructions and not questions:
        notes.append(_note(
            "instructions_missing", "warning", "instructions",
            "Sumá una consigna o las indicaciones de la evaluación",
            "Agregá al menos una consigna o las indicaciones de la evaluación: es lo que la IA usa para saber qué se le pidió al estudiante.",
        ))
    elif instructions and not questions and len(_words(instructions)) < MIN_INSTRUCTION_WORDS:
        notes.append(_note(
            "instructions_short", "info", "instructions",
            "Detallá las indicaciones",
            "Indicá qué se espera en la respuesta (extensión, tipo de justificación, si debe incluir ejemplos o un procedimiento).",
        ))

    if not material:
        notes.append(_note(
            "reference_missing", "info", "reference_material",
            "Importá el material de referencia",
            "Importá el apunte, la clase o la bibliografía (PDF, DOCX o TXT): las consignas y las correcciones se basan en lo que se trabajó y no en conocimiento general.",
        ))

    without_expected = [question for question in questions if not (getattr(question, "expected_answer", "") or "").strip()]
    if questions and without_expected:
        positions = ", ".join(str(getattr(question, "position", "?")) for question in without_expected[:6])
        notes.append(_note(
            "expected_answers_missing", "info", "questions",
            f"Anotá la respuesta esperada de {'la consigna' if len(without_expected) == 1 else 'las consignas'} {positions}",
            "Anotá en 2 o 3 oraciones qué debería incluir una respuesta completa: la corrección compara mejor y la devolución señala con precisión qué faltó.",
        ))

    if rubrics is not None:
        has_question_rubric = any(getattr(question, "rubric_id", None) for question in questions)
        if not rubrics and not has_question_rubric:
            notes.append(_note(
                "criteria_missing", "warning", "rubric",
                "Elegí o creá una rúbrica con los criterios de evaluación",
                "Sin rúbrica, la IA evalúa con un único criterio global y la devolución es menos específica. "
                "Creá una rúbrica con 3 a 5 criterios (podés pedírsela a la IA y editarla).",
            ))
        for rubric in rubrics or []:
            criteria = list(getattr(rubric, "prefetched_criteria", None) or [])
            if not criteria:
                continue
            vague = [criterion.name for criterion in criteria if len(_words(criterion.description)) < 6]
            if vague:
                notes.append(_note(
                    "rubric_criteria_vague", "info", "rubric",
                    f"Describí los criterios {', '.join(vague[:3])} de «{rubric.title}»",
                    "Describí en una oración qué se observa en la respuesta para valorar cada criterio, sin adjetivos vagos como «adecuado».",
                ))
            levels = [level for criterion in criteria for level in getattr(criterion, "prefetched_levels", [])]
            if levels and all(_plain(level.description).strip() in _GENERIC_LEVEL_TEXTS for level in levels):
                notes.append(_note(
                    "rubric_levels_generic", "info", "rubric",
                    f"Personalizá los niveles de «{rubric.title}»",
                    "Escribí qué distingue a cada nivel en cada criterio (qué hace la respuesta «En desarrollo» y qué la hace «Destacada»): la IA elige mejor el nivel y lo explica.",
                ))
            if criteria and sum(float(criterion.weight or 0) for criterion in criteria) <= 0:
                notes.append(_note(
                    "rubric_weights_zero", "warning", "rubric",
                    f"Asigná ponderaciones a los criterios de «{rubric.title}»",
                    "Asigná un peso a cada criterio según su importancia en los objetivos.",
                ))

    severity_order = {"warning": 0, "info": 1}
    return sorted(notes, key=lambda note: severity_order.get(note["severity"], 2))


def context_notes_for(assessment, questions=None) -> list[dict]:
    """Carga lo necesario (a lo sumo tres consultas) y devuelve `assess_context`.

    Se revisan en detalle las rúbricas vinculadas a las consignas; si no hay ninguna,
    alcanza con saber si el docente tiene alguna rúbrica para elegir al corregir.
    """
    from django.db.models import Prefetch
    from .models import Question, Rubric, RubricCriterion, RubricLevel

    owner_id = assessment.owner_id
    if questions is None:
        questions = Question.objects.filter(owner_id=owner_id, assessment=assessment).order_by("position", "id")
    questions = list(questions)
    rubric_ids = {question.rubric_id for question in questions if question.rubric_id}
    if rubric_ids:
        rubrics = list(Rubric.objects.filter(owner_id=owner_id, pk__in=rubric_ids).prefetch_related(Prefetch(
            "criteria",
            queryset=RubricCriterion.objects.filter(owner_id=owner_id).order_by("position", "id").prefetch_related(
                Prefetch("levels", queryset=RubricLevel.objects.filter(owner_id=owner_id), to_attr="prefetched_levels"),
            ),
            to_attr="prefetched_criteria",
        )))
    else:
        rubrics = list(Rubric.objects.filter(owner_id=owner_id).only("id")[:1])
    return assess_context(assessment, questions=questions, rubrics=rubrics)
