import httpx
from ..ai import REFERENCE_CONTEXT_CHARS as MAX_REFERENCE_CONTEXT_CHARS, DEFAULT_ASSESSMENT_SCALE, MIN_FINAL_GRADE, final_grade, locate_evidence, scale_rubric_to
from ..ai_guard import ai_slot
from ..models import AuditEvent
from .common import (
    AIUserRateThrottle,
    Assessment,
    Correction,
    CorrectionCriterionResult,
    CorrectionRevision,
    CorrectionSerializer,
    CorrectionSummarySerializer,
    Decimal,
    Enrollment,
    FormParser,
    HttpResponse,
    InvalidOperation,
    MAX_CORRECTION_ANSWERS,
    MAX_CORRECTION_INPUT_CHARS,
    MAX_CORRECTION_GENERATION_SECONDS,
    MethodNotAllowed,
    MultiPartParser,
    NotFound,
    OuterRef,
    OwnerViewSet,
    Path,
    Question,
    Response,
    Rubric,
    Student,
    Submission,
    SubmissionAnswer,
    SubmissionAnswerSerializer,
    SubmissionListSerializer,
    SubmissionSerializer,
    Subquery,
    Substr,
    ValidationError,
    _read_document,
    ai_error_code,
    ai_error_response,
    action,
    active_ai_provider_config,
    async_to_sync,
    asyncio,
    default_rubric_for_question,
    fingerprint,
    generate_correction,
    logger,
    os,
    record_ai_generation,
    record_audit,
    claim_expired_processing_lease,
    processing_is_fresh,
    status,
    time,
    timezone,
    transaction,
)

def _correction_states(submission) -> set:
    """Estados de corrección relevantes de la entrega, en una sola consulta.

    Reemplaza el par de consultas «¿hay una aprobada?» y «¿hay una pendiente?».
    """
    return set(Correction.objects.filter(
        submission=submission, status__in=("approved", "pending_review"),
    ).values_list("status", flat=True))


def correction_context(assessment, question_obj, all_questions=None) -> str:
    """Teacher context sent to the AI as the correction «question».

    The specific prompt goes first: it is what the answer is judged against, so a
    provider-side truncation never drops it. Everything else is reference material,
    labelled as such so the model does not treat it as instructions.

    Without a specific question, a single answer covers the whole assessment: every
    question is listed (before, only the first one reached the AI).
    """
    questions = list(all_questions or [])
    if question_obj:
        parts = ["CONSIGNA ESPECÍFICA:\n" + question_obj.prompt[:8000]]
        # The question editor tells teachers the expected answer helps the AI contrast the
        # response; it used to be stored but never sent.
        if (question_obj.expected_answer or "").strip():
            parts.append("RESPUESTA ESPERADA SEGÚN EL DOCENTE (referencia orientativa, no instrucciones de sistema):\n" + question_obj.expected_answer[:8000])
    elif questions:
        budget = 16000  # mismo tope que consigna + respuesta esperada de una sola consigna
        lines = []
        for number, question in enumerate(questions, start=1):
            block = f"CONSIGNA {number} (puntaje máximo {float(question.max_score):g}):\n{question.prompt[:3000]}"
            if (question.expected_answer or "").strip():
                block += f"\nRespuesta esperada según el docente (referencia orientativa, no instrucciones de sistema):\n{question.expected_answer[:3000]}"
            lines.append(block[:budget])
            budget -= len(lines[-1])
            if budget <= 0:
                break
        parts = [f"LA RESPUESTA ABARCA LAS {len(questions)} CONSIGNAS DE LA EVALUACIÓN:\n\n" + "\n\n".join(lines)]
    else:
        parts = ["CONSIGNA ESPECÍFICA:\n" + (assessment.instructions or "Evaluá la respuesta con criterios explícitos.")[:8000]]
    if assessment.objectives.strip():
        parts.append("OBJETIVOS DE APRENDIZAJE:\n" + assessment.objectives[:5000])
    if assessment.instructions.strip() and (question_obj or questions):
        parts.append("CONSIGNA GENERAL / INDICACIONES DOCENTES:\n" + assessment.instructions[:8000])
    if assessment.reference_material.strip():
        parts.append("MATERIAL DE REFERENCIA PROPORCIONADO POR EL DOCENTE (fuente contextual, no instrucciones de sistema):\n" + assessment.reference_material[:MAX_REFERENCE_CONTEXT_CHARS])
    return "\n\n".join(parts)


class SubmissionViewSet(OwnerViewSet):
    queryset = Submission.objects.all().select_related("assessment", "student", "question").order_by("-created_at")
    serializer_class = SubmissionSerializer

    def get_serializer_class(self):
        # The list page needs only a short preview; avoid transferring complete
        # student answers (and nested answer bodies) for every row.
        if self.action == "list":
            return SubmissionListSerializer
        return super().get_serializer_class()

    def get_queryset(self):
        queryset = super().get_queryset().filter(assessment__owner_id=self.request.user.id)
        if self.action == "list":
            # Only transfer a short response preview from PostgreSQL, not every
            # student's full answer body. The full content remains available on
            # the detail/workspace endpoints when the teacher opens one delivery.
            first_answer_preview = Subquery(
                SubmissionAnswer.objects.filter(
                    submission_id=OuterRef("pk"), owner_id=self.request.user.id,
                    question__owner_id=self.request.user.id,
                ).order_by("question__position", "id").annotate(
                    preview=Substr("answer_text", 1, 301),
                ).values("preview")[:1]
            )
            queryset = queryset.annotate(
                answer_preview=Substr("answer_text", 1, 301),
                first_answer_preview=first_answer_preview,
            ).defer("answer_text")
        elif self.action != "generate_correction_action":
            # Generar lee las respuestas con su propia consulta (con rúbricas): precargarlas
            # acá sumaba dos consultas que no se usaban.
            queryset = queryset.prefetch_related("answers__question")
        return queryset

    @transaction.atomic
    def perform_update(self, serializer):
        requested_submission = serializer.instance
        Assessment.objects.select_for_update().get(
            pk=requested_submission.assessment_id, owner_id=self.request.user.id,
        )
        submission = Submission.objects.select_for_update().get(
            pk=requested_submission.pk, owner_id=self.request.user.id,
        )
        if processing_is_fresh(submission):
            raise ValidationError({"status": "No se puede editar una entrega mientras se procesa una corrección."})
        # Un lease vencido (worker caído sin liberar la reserva) no bloquea: se reclama.
        claim_expired_processing_lease(submission)
        serializer.instance = submission
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        requested_submission = self.get_object()
        with transaction.atomic():
            Assessment.objects.select_for_update().get(
                pk=requested_submission.assessment_id, owner_id=request.user.id,
            )
            submission = Submission.objects.select_for_update().get(
                pk=requested_submission.pk, owner_id=request.user.id,
            )
            if processing_is_fresh(submission):
                raise ValidationError({"status": "No se puede eliminar una entrega mientras se procesa una corrección."})
            claim_expired_processing_lease(submission)
            if Correction.objects.filter(submission=submission).exists():
                return Response(
                    {"detail": "No se puede eliminar una entrega con historial de corrección. Conservá el registro y corregí la propuesta existente."},
                    status=status.HTTP_409_CONFLICT,
                )
            submission.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["post"], url_path="import-file", parser_classes=[MultiPartParser, FormParser])
    def import_file(self, request):
        uploaded = request.FILES.get("file")
        if not uploaded:
            raise ValidationError({"file": "Seleccioná un archivo de respuesta."})
        try:
            assessment = Assessment.objects.get(pk=request.data.get("assessment"), owner_id=request.user.id)
        except (Assessment.DoesNotExist, ValueError, TypeError):
            raise ValidationError({"assessment": "Seleccioná una evaluación válida."})
        question = None
        requested_question = request.data.get("question")
        if requested_question not in (None, "", "null"):
            try:
                question = Question.objects.get(pk=requested_question, assessment=assessment, owner_id=request.user.id)
            except (Question.DoesNotExist, ValueError, TypeError):
                raise ValidationError({"question": "Seleccioná una pregunta válida de esta evaluación."})
        student = None
        student_id = request.data.get("student")
        if student_id:
            try:
                student = Student.objects.get(pk=student_id, owner_id=request.user.id, active=True)
            except (Student.DoesNotExist, ValueError, TypeError):
                raise ValidationError({"student": "Estudiante no disponible."})
            if assessment.course_id and not Enrollment.objects.filter(owner_id=request.user.id, course_id=assessment.course_id, student=student, status="active").exists():
                raise ValidationError({"student": "El estudiante no está matriculado en el curso de esta evaluación."})
        text, source_type = _read_document(uploaded)
        submission = Submission.objects.create(
            owner_id=request.user.id, assessment=assessment, question=question, student=student,
            student_name=str(request.data.get("student_name", ""))[:180], answer_text=text,
            source_type=source_type, source_filename=Path(uploaded.name).name[:255], status="pending",
        )
        record_audit(request.user.id, "submission.imported", "submission", submission.id, {"source_type": source_type, "chars": len(text)}, request=request)
        return Response(self.get_serializer(submission).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="generate-correction", throttle_classes=[AIUserRateThrottle])
    def generate_correction_action(self, request, pk=None):
        # Validar propiedad (404) antes de consumir cupo; luego tomar un cupo de IA
        # del proceso para que las generaciones no agoten los hilos web (AUD-001).
        self.get_object()
        with ai_slot(request.user.id):
            return self._generate_correction(request, pk)

    def _generate_correction(self, request, pk=None):
        submission = self.get_object()
        submission_updated_at = submission.updated_at
        assessment_updated_at = submission.assessment.updated_at
        configured_provider = os.getenv("AI_PROVIDER", "mock").strip().lower()
        if submission.assessment.title.startswith("Ejemplo MaestrIA ·") and configured_provider == "mock":
            return Response({"detail": "El ejemplo docente requiere una corrección con IA real. El servidor está en modo MOCK y no se generarán puntajes simulados. Configurá un proveedor de IA y volvé a intentarlo."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        states = set() if submission.status == "approved" else _correction_states(submission)
        if submission.status == "approved" or "approved" in states:
            raise ValidationError({"submission": "Esta entrega ya tiene una corrección aprobada. Para reevaluarla deberá existir un flujo explícito de reapertura."})
        if "pending_review" in states:
            raise ValidationError({"submission": "Ya existe una propuesta pendiente para esta entrega. Revisala antes de generar otra."})
        question_items = []
        answer_objects = list(
            submission.answers.select_related("question__rubric").order_by("question__position", "id")
        )
        # Una respuesta única sin consigna puntual abarca todas las consignas de la
        # evaluación («Todas las consignas» en el espacio de trabajo). Antes se corregía
        # sólo contra la primera consigna aunque el estudiante hubiera respondido todas.
        all_questions = []
        if answer_objects:
            for answer_obj in answer_objects:
                question_items.append((answer_obj.question, answer_obj.answer_text, answer_obj))
        else:
            question_obj = submission.question
            if question_obj is None:
                all_questions = list(
                    submission.assessment.questions.select_related("rubric").order_by("position", "id")
                )
                if len(all_questions) == 1:
                    question_obj, all_questions = all_questions[0], []
            if not submission.answer_text.strip():
                raise ValidationError({"answer_text": "La entrega no contiene texto para corregir."})
            question_items.append((question_obj, submission.answer_text, None))

        # Defensive relationship checks also protect legacy data or writes made
        # outside this API; never send a cross-assessment answer to an AI provider.
        question_snapshots = {}
        checked_questions = [item[0] for item in question_items if item[0]] + all_questions
        for question_obj in checked_questions:
            if str(question_obj.owner_id) != str(request.user.id) or question_obj.assessment_id != submission.assessment_id:
                raise ValidationError({"answers": "La entrega contiene una pregunta que no pertenece a esta evaluación."})
            question_snapshots[question_obj.pk] = question_obj.updated_at
        for _question_obj, answer_text, _answer_obj in question_items:
            if not (answer_text or "").strip():
                raise ValidationError({"answers": "La entrega contiene una respuesta vacía; completala antes de corregir."})
        answer_snapshot = {answer.pk: answer.updated_at for answer in answer_objects}

        # One API call may invoke the model once per answer. Bound the number and
        # total size to prevent accidental or abusive cost/latency amplification.
        if len(question_items) > MAX_CORRECTION_ANSWERS:
            raise ValidationError({"answers": f"Una solicitud de corrección admite hasta {MAX_CORRECTION_ANSWERS} respuestas. Dividí la entrega en lotes más pequeños."})
        input_chars = sum(len(answer_text or "") for _, answer_text, _ in question_items)
        if input_chars > MAX_CORRECTION_INPUT_CHARS:
            raise ValidationError({"answers": f"Las respuestas suman {input_chars:,} caracteres; el límite por solicitud es {MAX_CORRECTION_INPUT_CHARS:,}. Dividí la entrega o resumí el texto."})

        requested_rubric = None
        rubric_id = request.data.get("rubric_id")
        if rubric_id:
            try:
                requested_rubric = Rubric.objects.filter(owner_id=request.user.id).get(pk=rubric_id)
            except (Rubric.DoesNotExist, ValueError, TypeError):
                raise NotFound("Rúbrica no encontrada.")

        feedback_style = str(request.data.get("feedback_style", "constructivo"))
        if feedback_style not in {"formal", "constructivo", "motivador"}:
            feedback_style = "constructivo"
        results, all_criteria, used_rubrics = [], [], []
        started = time.monotonic()
        context = {"submission": submission.pk, "questions": [item[0].pk if item[0] else None for item in question_items], "rubric_id": rubric_id or None}
        reservation_acquired = False
        reservation_timestamp = None

        def release_reservation():
            # A worker crash can leave a row in `processing`; the timestamp-based
            # lease below allows recovery after 15 minutes. Never reset a row that
            # has already been reviewed/approved or has an active correction.
            with transaction.atomic():
                current = Submission.objects.select_for_update().filter(
                    pk=submission.pk, owner_id=request.user.id,
                ).first()
                # Do not release a newer worker's lease if an old timed-out
                # request finishes after another request reclaimed the row.
                if current and current.status == "processing" and current.updated_at == reservation_timestamp:
                    if Correction.objects.filter(submission=current, status="approved").exists():
                        current.status = "approved"
                    elif Correction.objects.filter(submission=current, status="pending_review").exists():
                        current.status = "review"
                    else:
                        current.status = "pending"
                    current.save(update_fields=["status", "updated_at"])

        rubric_cache = {}

        def rubric_payload(rubric):
            """Criterios de una rúbrica (copias), cargados una sola vez por rúbrica.

            Varias consignas suelen compartir rúbrica: antes se leían sus criterios y
            niveles una vez por consigna. Las copias permiten renombrar sin afectar a otras.
            """
            if rubric.pk not in rubric_cache:
                rubric_cache[rubric.pk] = load_rubric(rubric)
            return [{**item, "levels": [dict(level) for level in item["levels"]]} for item in rubric_cache[rubric.pk]]

        def load_rubric(rubric):
            """Criterios de una rúbrica del docente, validando que todo sea de su cuenta."""
            if str(rubric.owner_id) != str(request.user.id):
                raise ValidationError({"rubric_id": "Rúbrica no disponible."})
            rubric_criteria = list(rubric.criteria.prefetch_related("levels").all())
            if len(rubric_criteria) > 20:
                raise ValidationError({"rubric_id": "La rúbrica supera el límite operativo de 20 criterios por corrección. Simplificala antes de generar."})
            payload = []
            for criterion in rubric_criteria:
                if str(criterion.owner_id) != str(request.user.id):
                    raise ValidationError({"rubric_id": "La rúbrica contiene criterios que no pertenecen a tu cuenta."})
                levels = list(criterion.levels.all())
                if len(levels) > 10:
                    raise ValidationError({"rubric_id": "Un criterio de la rúbrica contiene más de 10 niveles; reducí la cantidad."})
                if any(str(level.owner_id) != str(request.user.id) for level in levels):
                    raise ValidationError({"rubric_id": "La rúbrica contiene niveles que no pertenecen a tu cuenta."})
                payload.append({
                    "name": criterion.name, "description": criterion.description,
                    "max_score": float(criterion.max_score), "weight": float(criterion.weight),
                    "levels": [{"name": level.name, "description": level.description, "score": float(level.score)} for level in levels],
                })
            if not payload:
                raise ValidationError({"rubric_id": "La rúbrica seleccionada no tiene criterios. Agregá al menos uno o elegí otra rúbrica."})
            return payload

        try:
            prepared_items = []
            for question_obj, answer_text, answer_obj in question_items:
                effective_question = correction_context(
                    submission.assessment, question_obj, all_questions if question_obj is None else None,
                )
                # Consigna a la que corresponde cada criterio (None = toda la entrega).
                question_refs = []
                if question_obj is None and all_questions and not requested_rubric:
                    # Todas las consignas sin una rúbrica elegida: cada consigna aporta su
                    # rúbrica o un criterio global con su puntaje, rotulados «Consigna N».
                    # Así la IA puntúa y cita cada consigna por separado.
                    criteria = []
                    for number, question in enumerate(all_questions, start=1):
                        if question.rubric_id:
                            # La consigna manda: su rúbrica se reescala a sus puntos.
                            block = scale_rubric_to(rubric_payload(question.rubric), float(question.max_score))
                            used_rubrics.append(question.rubric)
                            for item in block:
                                item["name"] = f"Consigna {number} · {item['name']}"[:160]
                        else:
                            block = [{
                                "name": f"Consigna {number}",
                                "description": "Valorar la respuesta a esta consigna: " + question.prompt[:300],
                                "max_score": float(question.max_score), "weight": 1.0, "levels": [],
                            }]
                        criteria.extend(block)
                        question_refs.extend([question] * len(block))
                    if len(criteria) > 30:
                        raise ValidationError({"rubric_id": "Las rúbricas de las consignas suman más de 30 criterios. Elegí una sola rúbrica para toda la entrega o corregí una consigna por vez."})
                else:
                    rubric = requested_rubric or (question_obj.rubric if question_obj else None)
                    # Escala de la nota: los puntos de la consigna; para toda la entrega, la suma
                    # de los puntos de todas las consignas; sin consignas, 10.
                    if question_obj is not None:
                        scale = float(question_obj.max_score)
                    else:
                        scale = sum(float(item.max_score) for item in all_questions) or DEFAULT_ASSESSMENT_SCALE
                    if rubric:
                        criteria = scale_rubric_to(rubric_payload(rubric), scale)
                        used_rubrics.append(rubric)
                    else:
                        # No rubric means one global criterion, not model-invented subcriteria.
                        criteria = default_rubric_for_question(scale)
                effective_max = sum(float(item["max_score"]) for item in criteria)
                prepared_items.append({
                    "question": question_obj,
                    "question_refs": question_refs,
                    "answer_obj": answer_obj,
                    "answer_text": answer_text,
                    "effective_question": effective_question,
                    "criteria": criteria,
                    "effective_max": effective_max,
                })

            # A bounded pool overlaps network waits for multi-question submissions,
            # while limiting request bursts and provider quota/cost amplification.
            max_concurrency = min(max(int(os.getenv("AI_MAX_CONCURRENT_ANSWERS", "3")), 1), 3)

            provider_config = active_ai_provider_config()

            async def generate_all_proposals():
                semaphore = asyncio.Semaphore(max_concurrency)
                limits = httpx.Limits(
                    max_connections=max_concurrency,
                    max_keepalive_connections=max_concurrency,
                )
                # A single session reuses TLS/HTTP connections across answers in
                # this correction, then closes deterministically at request end.
                async with httpx.AsyncClient(limits=limits) as http_client:
                    async def generate_one(item):
                        async with semaphore:
                            return await generate_correction(
                                question=item["effective_question"],
                                answer=item["answer_text"],
                                rubric=item["criteria"],
                                max_score=item["effective_max"],
                                feedback_style=feedback_style,
                                provider_config=provider_config,
                                http_client=http_client,
                            )

                    return await asyncio.gather(*(generate_one(item) for item in prepared_items))

            # Reserve atomically before spending time/quota on an external model.
            # Concurrent requests for the same submission will see this lease and
            # stop before making duplicate provider calls.
            with transaction.atomic():
                # Lock in the same order as assessment/question mutation routes:
                # assessment first, then submission. This closes the preflight race.
                locked_assessment = Assessment.objects.select_for_update().get(
                    pk=submission.assessment_id, owner_id=request.user.id,
                )
                locked_submission = Submission.objects.select_for_update().get(
                    pk=submission.pk, owner_id=request.user.id,
                )
                if locked_submission.updated_at != submission_updated_at:
                    raise ValidationError({"submission": "La entrega cambió mientras se preparaba la corrección. Recargá el espacio e intentá nuevamente."})
                if locked_assessment.updated_at != assessment_updated_at:
                    raise ValidationError({"assessment": "La evaluación cambió mientras se preparaba la corrección. Recargá e intentá nuevamente."})
                current_answers = dict(SubmissionAnswer.objects.filter(
                    submission=locked_submission, owner_id=request.user.id,
                ).order_by("id").values_list("id", "updated_at"))
                if current_answers != answer_snapshot:
                    raise ValidationError({"answers": "Las respuestas cambiaron mientras se preparaba la corrección. Recargá e intentá nuevamente."})
                # Una consulta para todas las consignas (antes, una por consigna).
                current_questions = dict(Question.objects.filter(
                    pk__in=question_snapshots, owner_id=request.user.id,
                    assessment_id=submission.assessment_id,
                ).values_list("pk", "updated_at")) if question_snapshots else {}
                if current_questions != question_snapshots:
                    raise ValidationError({"questions": "Una consigna cambió mientras se preparaba la corrección. Recargá e intentá nuevamente."})
                locked_states = set() if locked_submission.status == "approved" else _correction_states(locked_submission)
                if locked_submission.status == "approved" or "approved" in locked_states:
                    raise ValidationError({"submission": "Esta entrega ya tiene una corrección aprobada."})
                if "pending_review" in locked_states:
                    raise ValidationError({"submission": "Ya existe una propuesta pendiente para esta entrega."})
                if processing_is_fresh(locked_submission):
                    raise ValidationError({"submission": "Esta entrega ya se está procesando. Esperá a que termine (o reintentá en unos minutos si el servidor se interrumpió) antes de reintentar."})
                locked_submission.status = "processing"
                locked_submission.save(update_fields=["status", "updated_at"])
                # El trigger `submission_touch_updated_at` (BEFORE UPDATE en
                # Supabase) reescribe updated_at con clock_timestamp(): el valor
                # del instance NO es el persistido. Releer para tomar el
                # timestamp real como identidad del lease; comparar el valor de
                # Python haría fallar siempre la confirmación y la liberación.
                locked_submission.refresh_from_db(fields=["updated_at"])
                reservation_timestamp = locked_submission.updated_at
                reservation_acquired = True

            async def generate_with_deadline():
                return await asyncio.wait_for(
                    generate_all_proposals(), timeout=MAX_CORRECTION_GENERATION_SECONDS,
                )

            proposals = async_to_sync(generate_with_deadline)()
            for item, proposal in zip(prepared_items, proposals):
                question_obj = item["question"]
                answer_obj = item["answer_obj"]
                refs = item["question_refs"]
                for position, criterion_data in enumerate(proposal.get("criteria", [])):
                    criterion_copy = dict(criterion_data)
                    # _validate_proposal devuelve los criterios en el orden de la rúbrica enviada.
                    criterion_question = question_obj or (refs[position] if position < len(refs) else None)
                    if criterion_question:
                        criterion_copy["question_id"] = criterion_question.pk
                        criterion_copy["question_prompt"] = criterion_question.prompt[:220]
                    criterion_copy["answer_id"] = answer_obj.pk if answer_obj else None
                    all_criteria.append(criterion_copy)
                results.append(proposal)
            if not all_criteria:
                raise RuntimeError("The model returned no criterion scores")
            aggregate = {
                "summary": " ".join(str(result.get("summary", "")) for result in results).strip()[:3000],
                "criteria": all_criteria,
                "feedback": "\n\n".join(str(result.get("feedback", "")) for result in results).strip()[:5000],
                "strengths": list(dict.fromkeys(text for result in results for text in result.get("strengths", [])))[:12],
                "improvement_suggestions": list(dict.fromkeys(text for result in results for text in result.get("improvement_suggestions", [])))[:12],
                "warnings": list(dict.fromkeys(w for result in results for w in result.get("warnings", [])))[:20],
                "demo": any(bool(result.get("demo")) for result in results),
            }
        except ValidationError:
            if reservation_acquired:
                release_reservation()
            raise
        except Exception as exc:
            if reservation_acquired:
                release_reservation()
            record_ai_generation(request.user.id, "generate_correction", started, False, fingerprint(context), ai_error_code(exc), assessment=submission.assessment, submission=submission, provider_config=locals().get("provider_config"))
            logger.warning("AI correction generation failed (%s)", ai_error_code(exc))
            return ai_error_response(exc, "No se pudo generar la propuesta. Revisá la configuración del proveedor de IA y los límites de uso.")

        total = Decimal(str(final_grade(aggregate["criteria"])))
        try:
            with transaction.atomic():
                # Recheck under a row lock after the external AI call. The lease
                # prevents normal concurrent retries; this protects against changes
                # made through other paths while the provider was running.
                locked_submission = Submission.objects.select_for_update().get(
                    pk=submission.pk, owner_id=request.user.id,
                )
                # A worker whose five-minute lease expired must not commit a stale
                # proposal after another request reclaimed the submission.
                if locked_submission.status != "processing" or locked_submission.updated_at != reservation_timestamp:
                    raise ValidationError({"submission": "El procesamiento fue reemplazado o venció. Recargá la entrega antes de intentar nuevamente."})
                final_states = _correction_states(locked_submission)
                if locked_submission.status == "approved" or "approved" in final_states:
                    raise ValidationError({"submission": "La entrega fue aprobada mientras se generaba la propuesta; no se creó otra corrección."})
                if "pending_review" in final_states:
                    raise ValidationError({"submission": "Otra solicitud creó una propuesta mientras se procesaba esta. Revisá la propuesta existente."})
                correction = Correction.objects.create(
                    owner_id=request.user.id, submission=locked_submission,
                    rubric=used_rubrics[0] if len(set(r.id for r in used_rubrics)) == 1 else requested_rubric,
                    provider=(provider_config or {}).get("provider") or os.getenv("AI_PROVIDER", "mock"), proposal=aggregate,
                    teacher_feedback=aggregate.get("feedback", ""), total_score=total,
                )
                locked_submission.status = "review"
                locked_submission.save(update_fields=["status", "updated_at"])
                record_audit(request.user.id, "correction.proposed", "correction", correction.id, {"provider": correction.provider, "demo": bool(aggregate.get("demo")), "criteria": len(aggregate["criteria"])}, request=request)
                # Persist operational telemetry in the same transaction as the
                # proposal so an audit/logging failure cannot return a false 500
                # after the correction was already committed.
                record_ai_generation(request.user.id, "generate_correction", started, True, fingerprint(context), assessment=submission.assessment, submission=submission, provider_config=provider_config)
        except ValidationError:
            if reservation_acquired:
                release_reservation()
            raise
        except Exception:
            if reservation_acquired:
                release_reservation()
            raise
        # Evaluación y estudiante ya están cargados (select_related de get_object) y son
        # inmutables en una entrega: se reutilizan en lugar de volver a consultarlos.
        correction.submission.assessment = submission.assessment
        correction.submission.student = submission.student
        return Response(_serialize_correction(correction), status=status.HTTP_201_CREATED)

def _serialize_correction(correction):
    return {
        "id": correction.id, "submission": correction.submission_id,
        "submission_title": correction.submission.assessment.title,
        "submission_assessment_id": correction.submission.assessment_id,
        "student_name": correction.submission.student.name if correction.submission.student_id else correction.submission.student_name,
        "provider": correction.provider, "proposal": correction.proposal, "final_result": correction.final_result,
        "teacher_feedback": correction.teacher_feedback, "total_score": str(correction.total_score),
        "status": correction.status, "created_at": correction.created_at.isoformat(),
        "student_id": correction.submission.student_id,
        "course_id": correction.submission.assessment.course_id,
        "course_name": correction.submission.assessment.course.name if correction.submission.assessment.course else None,
        "subject": correction.submission.assessment.subject,
    }

class SubmissionAnswerViewSet(OwnerViewSet):
    queryset = SubmissionAnswer.objects.all().select_related("submission", "question")
    serializer_class = SubmissionAnswerSerializer

    def get_queryset(self):
        return super().get_queryset().filter(submission__owner_id=self.request.user.id, question__owner_id=self.request.user.id)

    @transaction.atomic
    def perform_create(self, serializer):
        requested_submission = serializer.validated_data["submission"]
        question = serializer.validated_data["question"]
        if str(requested_submission.owner_id) != str(self.request.user.id) or str(question.owner_id) != str(self.request.user.id):
            raise ValidationError("Entrega o pregunta no disponible.")
        # Match the generation workflow's lock order to prevent an answer being
        # added after the worker has taken its snapshot but before it reserves it.
        Assessment.objects.select_for_update().get(
            pk=requested_submission.assessment_id, owner_id=self.request.user.id,
        )
        submission = Submission.objects.select_for_update().get(
            pk=requested_submission.pk, owner_id=self.request.user.id,
        )
        if processing_is_fresh(submission):
            raise ValidationError({"submission": "No se pueden agregar respuestas mientras se procesa una corrección."})
        claim_expired_processing_lease(submission)
        serializer.save(owner_id=self.request.user.id, submission=submission)

    @transaction.atomic
    def perform_update(self, serializer):
        requested_submission = serializer.instance.submission
        Assessment.objects.select_for_update().get(
            pk=requested_submission.assessment_id, owner_id=self.request.user.id,
        )
        submission = Submission.objects.select_for_update().get(
            pk=requested_submission.pk, owner_id=self.request.user.id,
        )
        if processing_is_fresh(submission):
            raise ValidationError({"submission": "No se pueden modificar respuestas mientras se procesa una corrección."})
        claim_expired_processing_lease(submission)
        serializer.instance.submission = submission
        serializer.save()

class CorrectionViewSet(OwnerViewSet):
    queryset = Correction.objects.all().select_related("submission__assessment__course", "submission__student", "rubric").prefetch_related("criterion_results").order_by("-created_at")
    serializer_class = CorrectionSerializer

    def get_serializer_class(self):
        if self.action == "list" and self.request.query_params.get("summary") == "1":
            return CorrectionSummarySerializer
        return super().get_serializer_class()

    def get_queryset(self):
        queryset = super().get_queryset().filter(
            owner_id=self.request.user.id,
            submission__owner_id=self.request.user.id,
            submission__assessment__owner_id=self.request.user.id,
        )
        course_id = self.request.query_params.get("course")
        if course_id is not None:
            try:
                parsed_course_id = int(course_id)
                if parsed_course_id < 1:
                    raise ValueError
            except (TypeError, ValueError):
                raise ValidationError({"course": "El filtro de curso debe ser un identificador válido."})
            queryset = queryset.filter(submission__assessment__course_id=parsed_course_id)
        if self.action == "list" and self.request.query_params.get("summary") == "1":
            # The course dashboard needs small identifying fields, not proposal JSON,
            # rubric criteria or full answer bodies. Keep joins explicit to avoid N+1s.
            # Clear the default select_related("rubric") before narrowing columns.
            # Django raises FieldError if a relation is both deferred by only()
            # and traversed through select_related().
            queryset = queryset.select_related(None).select_related(
                "submission__assessment__course", "submission__student",
            ).prefetch_related(None).only(
                "id", "owner_id", "submission_id", "status", "provider", "total_score", "created_at",
                "submission__id", "submission__student_id", "submission__student_name",
                "submission__assessment_id", "submission__assessment__title",
                "submission__assessment__subject", "submission__assessment__course_id",
                "submission__assessment__course__id", "submission__assessment__course__name",
                "submission__student__id", "submission__student__name",
            )
        if getattr(self, "action", None) == "approve":
            # Bloquea únicamente la fila Correction.
            # Evita bloquear el lado nullable de los JOIN.
            queryset = queryset.select_for_update(of=("self",))
        return queryset

    def create(self, request, *args, **kwargs):
        raise MethodNotAllowed("POST", detail="Las correcciones solo se crean mediante el flujo de generación.")

    def update(self, request, *args, **kwargs):
        raise MethodNotAllowed("PUT", detail="Usá el endpoint de aprobación para confirmar la corrección.")

    def partial_update(self, request, *args, **kwargs):
        raise MethodNotAllowed("PATCH", detail="Usá el endpoint de aprobación para confirmar la corrección.")

    def destroy(self, request, *args, **kwargs):
        raise MethodNotAllowed("DELETE", detail="El historial de correcciones se conserva en esta versión.")

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def approve(self, request, pk=None):
        correction = self.get_object()
        locked_submission = Submission.objects.select_for_update().get(
            pk=correction.submission_id, owner_id=request.user.id,
        )
        if Correction.objects.filter(
            submission=locked_submission, status="approved",
        ).exclude(pk=correction.pk).exists():
            raise ValidationError({"submission": "Esta entrega ya tiene otra corrección aprobada."})
        if isinstance(correction.proposal, dict) and correction.proposal.get("demo"):
            raise ValidationError("Las propuestas demostrativas no se pueden aprobar como una calificación real.")
        if correction.status == "approved":
            raise ValidationError("La corrección ya fue aprobada. Para volver a modificarla deberá generarse una nueva revisión explícita.")
        if not isinstance(correction.proposal, dict) or not isinstance(correction.proposal.get("criteria"), list):
            raise ValidationError("La propuesta guardada no tiene una estructura válida para aprobarse.")
        baseline = correction.proposal["criteria"]
        if not baseline or any(not isinstance(item, dict) for item in baseline):
            raise ValidationError({"final_result": "La propuesta debe incluir al menos un criterio válido antes de aprobarse."})

        final_result = request.data.get("final_result", correction.proposal)
        feedback = str(request.data.get("teacher_feedback", correction.teacher_feedback))[:5000]
        if not isinstance(final_result, dict) or not isinstance(final_result.get("criteria"), list):
            raise ValidationError({"final_result": "Debe ser un objeto JSON con una lista criteria."})
        submitted_items = final_result["criteria"]
        if len(submitted_items) != len(baseline):
            raise ValidationError({"final_result": "No se pueden agregar ni quitar criterios al aprobar una propuesta."})

        # When the teacher materially changes a proposed score, preserve a concise
        # pedagogical reason in the immutable revision trail. Feedback edits alone
        # do not trigger this requirement, so normal proofreading stays lightweight.
        change_reason = str(request.data.get("change_reason", "")).strip()[:500]
        score_changed = False
        for base_item, submitted_item in zip(baseline, submitted_items):
            if not isinstance(submitted_item, dict):
                continue
            try:
                base_score = Decimal(str(base_item.get("score", 0)))
                submitted_score = Decimal(str(submitted_item.get("score", 0)))
            except (InvalidOperation, ValueError, TypeError):
                # Existing score validation below returns the field-level error.
                continue
            if base_score != submitted_score:
                score_changed = True
                break
        if score_changed and len(change_reason) < 8:
            raise ValidationError({"change_reason": "Explicá brevemente por qué ajustaste el puntaje (al menos 8 caracteres)."})

        source_texts = [correction.submission.answer_text]
        source_texts.extend(c.answer_text for c in correction.submission.answers.all())
        full_source_text = "\n".join(text for text in source_texts if text)
        validated_criteria = []
        for index, item in enumerate(submitted_items):
            if not isinstance(item, dict):
                raise ValidationError({"final_result": "Cada criterio debe ser un objeto."})
            base_item = baseline[index]
            try:
                maximum = max(Decimal("0"), Decimal(str(base_item.get("max_score", 0))))
                score = Decimal(str(item.get("score", 0)))
            except (InvalidOperation, ValueError, TypeError) as exc:
                raise ValidationError({"final_result": "Los puntajes deben ser numéricos."}) from exc
            if not maximum.is_finite() or not score.is_finite():
                raise ValidationError({"final_result": "Los puntajes deben ser números finitos."})
            if score < 0 or score > maximum:
                raise ValidationError({"final_result": f"El puntaje de {base_item.get('criterion', 'un criterio')} debe estar entre 0 y {maximum}."})
            evidence = str(item.get("evidence", base_item.get("evidence", "")))[:1000]
            exact_evidence = ""
            if evidence:
                # Tolerante a saltos de línea/espacios/comillas; se guarda el texto exacto de la fuente.
                exact_evidence = locate_evidence(evidence, full_source_text)
                if exact_evidence:
                    evidence = exact_evidence[:1000]
            if evidence and not exact_evidence:
                raise ValidationError({"final_result": f"La evidencia del criterio {base_item.get('criterion', index + 1)} debe coincidir literalmente con una respuesta cargada."})
            validated_criteria.append({
                **base_item, "score": float(score), "max_score": float(maximum),
                "justification": str(item.get("justification", base_item.get("justification", "")))[:3000],
                "evidence": evidence,
            })
        # Nota final: la calculada por criterios o, si el docente la fija a mano, la suya
        # (entre la nota mínima y el máximo de la evaluación, con motivo obligatorio).
        computed_score = Decimal(str(final_grade(validated_criteria)))
        total_max = sum((Decimal(str(item["max_score"])) for item in validated_criteria), Decimal("0"))
        final_score, overridden = computed_score, False
        raw_final = request.data.get("final_score")
        if raw_final not in (None, ""):
            try:
                requested = Decimal(str(raw_final).replace(",", "."))
            except (InvalidOperation, ValueError, TypeError) as exc:
                raise ValidationError({"final_score": "La nota final debe ser un número."}) from exc
            if not requested.is_finite():
                raise ValidationError({"final_score": "La nota final debe ser un número finito."})
            minimum = Decimal(str(MIN_FINAL_GRADE)) if total_max >= Decimal(str(MIN_FINAL_GRADE)) else Decimal("0")
            if requested < minimum or requested > total_max:
                raise ValidationError({"final_score": f"La nota final debe estar entre {minimum.normalize():f} y {total_max.normalize():f}."})
            requested = requested.quantize(Decimal("0.01"))
            if abs(requested - computed_score) >= Decimal("0.005"):
                final_score, overridden = requested, True
        if overridden and len(change_reason) < 8:
            raise ValidationError({"change_reason": "Explicá brevemente por qué modificaste la nota final (al menos 8 caracteres)."})
        final_result = {
            **final_result, "criteria": validated_criteria, "demo": bool(correction.proposal.get("demo", False)),
            "computed_score": float(computed_score), "final_score": float(final_score), "final_score_overridden": overridden,
        }
        with transaction.atomic():
            revision_number = (correction.revisions.order_by("-revision_number").values_list("revision_number", flat=True).first() or 0) + 1
            CorrectionRevision.objects.create(
                correction=correction, owner_id=request.user.id, revision_number=revision_number,
                previous_result=correction.final_result or {}, new_result=final_result,
                reason=(change_reason if (score_changed or overridden) else "Aprobación docente sin cambios de puntaje")[:250],
            )
            correction.final_result = final_result
            correction.teacher_feedback = feedback
            correction.status = "approved"
            correction.approved_at = timezone.now()
            correction.total_score = final_score
            correction.save(update_fields=["final_result", "teacher_feedback", "status", "approved_at", "total_score", "updated_at"])
            correction.criterion_results.all().delete()
            # Una consulta para todas las consignas y una inserción masiva (antes: una consulta
            # y un INSERT por criterio, ~180 ms cada uno entre Render y Supabase).
            question_ids = set()
            for item in validated_criteria:
                question_id = item.get("question_id")
                if question_id not in (None, ""):
                    try:
                        question_ids.add(int(question_id))
                    except (ValueError, TypeError) as exc:
                        raise ValidationError({"final_result": "Una pregunta de la propuesta no pertenece a esta evaluación."}) from exc
            questions_by_id = Question.objects.filter(
                owner_id=request.user.id,
                assessment_id=correction.submission.assessment_id,
                pk__in=question_ids,
            ).in_bulk() if question_ids else {}
            if len(questions_by_id) != len(question_ids):
                raise ValidationError({"final_result": "Una pregunta de la propuesta no pertenece a esta evaluación."})
            CorrectionCriterionResult.objects.bulk_create([
                CorrectionCriterionResult(
                    owner_id=request.user.id, correction=correction,
                    question=questions_by_id.get(int(item["question_id"])) if item.get("question_id") not in (None, "") else None,
                    criterion_name=str(item.get("criterion", "Criterio"))[:160],
                    score=Decimal(str(item["score"])), max_score=Decimal(str(item["max_score"])),
                    evidence=str(item.get("evidence", ""))[:5000],
                    justification=str(item.get("justification", ""))[:5000],
                    feedback=feedback, position=position,
                )
                for position, item in enumerate(validated_criteria, start=1)
            ])
            locked_submission.status = "approved"
            locked_submission.save(update_fields=["status", "updated_at"])
            record_audit(request.user.id, "correction.approved", "correction", correction.id, {"demo": bool(final_result.get("demo"))}, request=request)
        correction.refresh_from_db()
        return Response(self.get_serializer(correction).data)

    DELIVERY_CHANNELS = {"email", "whatsapp", "print", "copy", "manual"}

    @action(detail=True, methods=["get", "post"], url_path="deliveries")
    def deliveries(self, request, pk=None):
        """Registro de devoluciones preparadas/entregadas de una corrección aprobada.

        MaestrIA no envía mensajes por su cuenta ni puede confirmar la recepción: el docente
        prepara el envío (correo, WhatsApp, PDF, copia) y este endpoint deja constancia con
        fecha, canal y destinatario. `confirmed` marca que el docente confirmó haberlo enviado.
        """
        correction = self.get_object()
        if request.method == "GET":
            events = AuditEvent.objects.filter(
                owner_id=request.user.id, object_type="correction", object_id=str(correction.id),
                event_type="correction.delivery",
            ).order_by("-created_at").values("id", "detail", "created_at")[:50]
            return Response({"results": [{"id": e["id"], "created_at": e["created_at"].isoformat(), **(e["detail"] or {})} for e in events]})
        if correction.status != "approved" or not correction.approved_at:
            raise ValidationError({"correction": "Solo se registran devoluciones de correcciones aprobadas."})
        channel = str(request.data.get("channel", "")).strip().lower()
        if channel not in self.DELIVERY_CHANNELS:
            raise ValidationError({"channel": "Canal inválido. Usá: " + ", ".join(sorted(self.DELIVERY_CHANNELS)) + "."})
        recipient = str(request.data.get("recipient", "")).strip()[:254]
        detail = {"channel": channel, "recipient": recipient, "confirmed": bool(request.data.get("confirmed", False)),
                  "student_id": correction.submission.student_id, "note": str(request.data.get("note", "")).strip()[:300]}
        record_audit(request.user.id, "correction.delivery", "correction", correction.id, detail, request=request)
        return Response({"registered": True, **detail}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], url_path="export")
    def export_markdown(self, request, pk=None):
        correction = self.get_object()
        data = correction.final_result if correction.status == "approved" else correction.proposal
        name = correction.submission.student.name if correction.submission.student else correction.submission.student_name or "Estudiante"

        def number(value):
            # Formato local, igual que en la interfaz y el CSV de notas: 6,5 en lugar de 6.50.
            try:
                return f"{float(value):.2f}".rstrip("0").rstrip(".").replace(".", ",")
            except (TypeError, ValueError):
                return "0"

        criteria = data.get("criteria", [])
        total_max = sum(float(item.get("max_score") or 0) for item in criteria if isinstance(item, dict))
        total = f"{number(correction.total_score)} / {number(total_max)}" if total_max else number(correction.total_score)
        if data.get("final_score_overridden"):
            total += f" (fijada por el docente; calculada: {number(data.get('computed_score'))})"
        lines = [
            f"# Devolución — {correction.submission.assessment.title}", "",
            *(["**ADVERTENCIA: resultado demostrativo/simulado; no utilizar como calificación real.**", ""] if data.get("demo") else []),
            f"**Estudiante:** {name}",
            f"**Estado:** {'Aprobada por el docente' if correction.status == 'approved' else 'Propuesta pendiente de revisión'}",
            f"**Nota:** {total}", "", "## Criterios",
        ]
        for item in criteria:
            lines += [f"### {item.get('question_prompt', item.get('criterion', 'Criterio'))}", f"**{item.get('criterion', 'Criterio')}** — Puntaje: {number(item.get('score', 0))} / {number(item.get('max_score', 0))}", str(item.get("justification", "")), f"Evidencia: {item.get('evidence', '')}", ""]
        lines += ["## Retroalimentación", correction.teacher_feedback or data.get("feedback", "")]
        response = HttpResponse("\n".join(lines), content_type="text/markdown; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="devolucion-maestria.md"'
        response["X-Content-Type-Options"] = "nosniff"
        return response
