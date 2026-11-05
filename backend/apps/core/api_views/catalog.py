from .common import (
    AIUserRateThrottle,
    Assessment,
    AssessmentEditorSerializer,
    AssessmentListSerializer,
    AssessmentSerializer,
    Course,
    CourseNavigationSerializer,
    CourseOptionSerializer,
    CourseSerializer,
    DjangoValidationError,
    Enrollment,
    EnrollmentSerializer,
    FormParser,
    MAX_ANSWER_CHARS,
    Max,
    MultiPartParser,
    OwnerViewSet,
    Question,
    QuestionSerializer,
    Response,
    Rubric,
    RubricCriterion,
    RubricCriterionSerializer,
    RubricLevel,
    RubricLevelSerializer,
    RubricSerializer,
    Student,
    StudentSerializer,
    Submission,
    SubmissionAnswer,
    ValidationError,
    _read_document,
    _safe_ai_error_detail,
    ai_error_code,
    action,
    active_ai_provider_config,
    async_to_sync,
    courses_with_dashboard_counts,
    csv,
    fingerprint,
    generate_questions,
    generate_rubric,
    io,
    logger,
    record_ai_generation,
    record_audit,
    status,
    time,
    transaction,
    validate_email,
)

class CourseViewSet(OwnerViewSet):
    # Keep a model-bound queryset for router basename discovery. The full list
    # uses correlated subqueries to avoid enrollment × assessment row fan-out.
    queryset = Course.objects.all()
    serializer_class = CourseSerializer

    def get_queryset(self):
        # Navigation and selector calls do not need expensive aggregate counts or
        # long descriptions. Keep the rich annotated queryset for the course page.
        if self.action == "list" and self.request.query_params.get("nav") == "1":
            return Course.objects.filter(owner_id=self.request.user.id).only(
                "id", "name", "subject", "level", "academic_year", "active",
            ).order_by("name", "id")
        return courses_with_dashboard_counts(self.request.user.id)

    def get_serializer_class(self):
        if self.action == "list" and self.request.query_params.get("nav") == "1":
            return CourseNavigationSerializer
        return super().get_serializer_class()

    def _save_course(self, serializer, **kwargs):
        owner_id = kwargs.get("owner_id") or self.request.user.id
        with transaction.atomic():
            # The canonical database schema has no case-insensitive unique index.
            # Lock the Auth identity row so concurrent API writes for one owner
            # serialize duplicate checks without inventing a database constraint.
            from django.db import connection
            with connection.cursor() as cursor:
                cursor.execute("SELECT id FROM auth.users WHERE id = %s FOR UPDATE", [str(owner_id)])
                if cursor.fetchone() is None:
                    raise ValidationError({"detail": "La identidad autenticada no existe en Supabase Auth."})
            name = serializer.validated_data.get("name", getattr(serializer.instance, "name", ""))
            duplicates = Course.objects.filter(owner_id=owner_id, name__iexact=name.strip())
            if serializer.instance:
                duplicates = duplicates.exclude(pk=serializer.instance.pk)
            if duplicates.exists():
                raise ValidationError({"name": "Ya existe un curso con ese nombre en tu cuenta."})
            serializer.save(**kwargs)

    def perform_create(self, serializer):
        self._save_course(serializer, owner_id=self.request.user.id)

    def perform_update(self, serializer):
        self._save_course(serializer)

    def perform_destroy(self, instance):
        # Keep historical course/assessment relationships; deletion is logical.
        instance.active = False
        instance.save(update_fields=["active", "updated_at"])

class EnrollmentViewSet(OwnerViewSet):
    queryset = Enrollment.objects.all().select_related("course", "student")
    serializer_class = EnrollmentSerializer

    def perform_create(self, serializer):
        with transaction.atomic():
            course = serializer.validated_data["course"]
            student = serializer.validated_data["student"]
            Course.objects.select_for_update().get(pk=course.pk, owner_id=self.request.user.id)
            Student.objects.select_for_update().get(pk=student.pk, owner_id=self.request.user.id)
            if serializer.validated_data.get("status", "active") == "active" and Enrollment.objects.filter(
                owner_id=self.request.user.id, course_id=course.pk, student_id=student.pk, status="active",
            ).exists():
                raise ValidationError({"student": "El estudiante ya tiene una matrícula activa en este curso."})
            serializer.save(owner_id=self.request.user.id)

    def perform_update(self, serializer):
        from django.db import connection
        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("SELECT id FROM auth.users WHERE id = %s FOR UPDATE", [str(self.request.user.id)])
            if cursor.fetchone() is None:
                raise ValidationError({"detail": "La identidad autenticada no existe en Supabase Auth."})
            course = serializer.validated_data.get("course", serializer.instance.course)
            student = serializer.validated_data.get("student", serializer.instance.student)
            course = Course.objects.select_for_update().get(pk=course.pk, owner_id=self.request.user.id)
            student = Student.objects.select_for_update().get(pk=student.pk, owner_id=self.request.user.id)
            next_status = serializer.validated_data.get("status", serializer.instance.status)
            if next_status == "active":
                duplicate = Enrollment.objects.filter(owner_id=self.request.user.id, course_id=course.pk, student_id=student.pk, status="active").exclude(pk=serializer.instance.pk)
                if duplicate.exists():
                    raise ValidationError({"student": "El estudiante ya tiene una matrícula activa en este curso."})
            serializer.save()

    def get_queryset(self):
        queryset = super().get_queryset().filter(course__owner_id=self.request.user.id, student__owner_id=self.request.user.id)
        course_id = self.request.query_params.get("course")
        if course_id:
            queryset = queryset.filter(course_id=course_id)
        return queryset

class AssessmentViewSet(OwnerViewSet):
    queryset = Assessment.objects.all().select_related("course").order_by("-updated_at")
    serializer_class = AssessmentSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        course_id = self.request.query_params.get("course")
        if course_id is not None:
            try:
                parsed_course_id = int(course_id)
                if parsed_course_id < 1:
                    raise ValueError
            except (TypeError, ValueError):
                raise ValidationError({"course": "El filtro de curso debe ser un identificador válido."})
            queryset = queryset.filter(course_id=parsed_course_id)
        if self.action == "retrieve":
            queryset = queryset.prefetch_related("questions")
        return queryset

    def get_serializer_class(self):
        if self.action == "list":
            return AssessmentListSerializer
        return super().get_serializer_class()

    def perform_update(self, serializer):
        # The generation worker reads an evaluation as a coherent input snapshot.
        # Lock the parent row in the same order as the worker and reject edits
        # while an associated delivery is processing.
        with transaction.atomic():
            assessment = Assessment.objects.select_for_update().get(
                pk=serializer.instance.pk, owner_id=self.request.user.id,
            )
            if Submission.objects.filter(
                owner_id=self.request.user.id, assessment=assessment, status="processing",
            ).exists():
                raise ValidationError({"assessment": "No se puede editar la evaluación mientras se procesa una corrección."})
            serializer.instance = assessment
            serializer.save()

    @action(detail=True, methods=["get"], url_path="editor")
    def editor(self, request, pk=None):
        """Small payload for preparing an evaluation without loading submissions or rubrics."""
        assessment = self.get_object()
        owner_id = request.user.id
        questions = Question.objects.filter(owner_id=owner_id, assessment=assessment).order_by("position", "id")
        courses = CourseOptionSerializer(Course.objects.filter(owner_id=owner_id, active=True).order_by("name"), many=True).data
        return Response({
            "assessment": AssessmentEditorSerializer(assessment, context={"request": request}).data,
            "questions": QuestionSerializer(questions, many=True, context={"request": request}).data,
            "courses": courses,
        })

    @action(detail=True, methods=["post"], url_path="import-reference", parser_classes=[MultiPartParser, FormParser])
    def import_reference(self, request, pk=None):
        """Extract a teacher reference file in memory and save only its text."""
        assessment = self.get_object()
        uploaded = request.FILES.get("file")
        if not uploaded:
            raise ValidationError({"file": "Seleccioná un apunte o material de referencia."})
        mode = str(request.data.get("mode", "replace"))
        if mode not in {"replace", "append"}:
            raise ValidationError({"mode": "Usá replace o append."})
        # Parse the uploaded document before taking a database lock. For append,
        # merge against a freshly locked row so concurrent imports cannot overwrite
        # each other's changes with a stale in-memory Assessment instance.
        text, source_type = _read_document(uploaded)
        with transaction.atomic():
            assessment = Assessment.objects.select_for_update().get(
                pk=assessment.pk, owner_id=request.user.id,
            )
            if Submission.objects.filter(
                owner_id=request.user.id, assessment=assessment, status="processing",
            ).exists():
                raise ValidationError({"assessment": "No se puede cambiar el material mientras se procesa una corrección."})
            combined = (
                text
                if mode == "replace" or not assessment.reference_material
                else assessment.reference_material.rstrip() + "\n\n" + text
            )
            if len(combined) > MAX_ANSWER_CHARS:
                raise ValidationError({"file": "El material combinado supera los 50.000 caracteres. Reemplazá el material existente o resumí los documentos."})
            assessment.reference_material = combined
            assessment.save(update_fields=["reference_material", "updated_at"])
            record_audit(request.user.id, "assessment.reference_imported", "assessment", assessment.id, {"source_type": source_type, "chars": len(text), "mode": mode}, request=request)
        return Response({"assessment_id": assessment.id, "source_type": source_type, "chars": len(text), "total_chars": len(combined), "reference_material": combined})

    @action(detail=True, methods=["post"], url_path="generate-questions", throttle_classes=[AIUserRateThrottle])
    def generate_questions_action(self, request, pk=None):
        assessment = self.get_object()
        started = time.monotonic()
        context = {"assessment": assessment.pk, "count": request.data.get("count", 3)}
        try:
            try:
                count = int(request.data.get("count", 3))
            except (ValueError, TypeError) as exc:
                raise ValidationError({"count": "La cantidad debe ser un número entero entre 1 y 5."}) from exc
            if not 1 <= count <= 5:
                raise ValidationError({"count": "Solicitá entre 1 y 5 preguntas por vez."})
            provider_config = active_ai_provider_config()
            result = async_to_sync(generate_questions)(
                title=assessment.title, subject=assessment.subject, level=assessment.level,
                objectives=assessment.objectives, instructions=assessment.instructions,
                reference_material=assessment.reference_material, count=count, provider_config=provider_config,
            )
            record_ai_generation(request.user.id, "generate_questions", started, True, fingerprint(context), assessment=assessment, provider_config=provider_config)
            record_audit(request.user.id, "questions.proposed", "assessment", assessment.id, {"count": len(result.get("questions", [])), "demo": bool(result.get("demo"))}, request=request)
        except ValidationError:
            raise
        except Exception as exc:
            record_ai_generation(request.user.id, "generate_questions", started, False, fingerprint(context), ai_error_code(exc), assessment=assessment, provider_config=locals().get("provider_config"))
            logger.warning("AI questions generation failed (%s)", type(exc).__name__)
            return Response({"detail": _safe_ai_error_detail(exc, "No se pudieron generar preguntas. Revisá la configuración del proveedor de IA y volvé a intentar.")}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(result, status=status.HTTP_200_OK)

class StudentViewSet(OwnerViewSet):
    queryset = Student.objects.all().prefetch_related("enrollments__course").order_by("name")
    serializer_class = StudentSerializer

    def perform_update(self, serializer):
        from django.db import connection
        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("SELECT id FROM auth.users WHERE id = %s FOR UPDATE", [str(self.request.user.id)])
            if cursor.fetchone() is None:
                raise ValidationError({"detail": "La identidad autenticada no existe en Supabase Auth."})
            code = str(serializer.validated_data.get("external_code", getattr(serializer.instance, "external_code", ""))).strip()
            if code:
                duplicates = Student.objects.filter(owner_id=self.request.user.id, external_code=code).exclude(pk=serializer.instance.pk)
                if duplicates.exists():
                    raise ValidationError({"external_code": "Ya existe un estudiante con ese código externo."})
            serializer.save()

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        # Lock the Auth identity row so duplicate external_code checks serialize
        # across requests, since the canonical physical schema has no unique index.
        from django.db import connection
        with connection.cursor() as cursor:
            cursor.execute("SELECT id FROM auth.users WHERE id = %s FOR UPDATE", [str(request.user.id)])
            if cursor.fetchone() is None:
                raise ValidationError({"detail": "La identidad autenticada no existe en Supabase Auth."})
        course_id = request.data.get("course")
        try:
            course = Course.objects.select_for_update().get(pk=course_id, owner_id=request.user.id, active=True)
        except (Course.DoesNotExist, ValueError, TypeError):
            raise ValidationError({"course": "Elegí una materia o curso activo antes de agregar al estudiante."})
        payload = request.data.copy()
        payload.pop("course", None)
        serializer = self.get_serializer(data=payload)
        serializer.is_valid(raise_exception=True)
        student = serializer.save(owner_id=request.user.id)
        Enrollment.objects.create(owner_id=request.user.id, course=course, student=student, status="active")
        student = self.get_queryset().get(pk=student.pk)
        return Response(self.get_serializer(student).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="import-csv", parser_classes=[MultiPartParser, FormParser])
    @transaction.atomic
    def import_csv(self, request):
        uploaded = request.FILES.get("file")
        if not uploaded:
            raise ValidationError({"file": "Adjuntá un CSV con una columna obligatoria name y columnas opcionales email, phone, external_code."})
        if uploaded.size > 2 * 1024 * 1024:
            raise ValidationError({"file": "El archivo supera el límite de 2 MB."})
        try:
            course = Course.objects.get(pk=request.data.get("course"), owner_id=request.user.id, active=True)
        except (Course.DoesNotExist, ValueError, TypeError):
            raise ValidationError({"course": "Elegí una materia o curso activo para asignar a los estudiantes importados."})
        try:
            text = uploaded.read().decode("utf-8-sig")
            # Excel en español exporta con «;»: se detecta el separador de la primera línea.
            header_line = text.splitlines()[0] if text.strip() else ""
            delimiter = max(",;\t", key=header_line.count) if header_line.count(",") + header_line.count(";") + header_line.count("\t") else ","
            reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
            if reader.fieldnames:
                reader.fieldnames = [str(item or "").strip().lower() for item in reader.fieldnames]
            if not reader.fieldnames or "name" not in reader.fieldnames:
                raise ValidationError({"file": "El CSV debe incluir una columna name."})
            created, skipped, errors = 0, 0, []
            owner_id = request.user.id
            from django.db import connection
            with connection.cursor() as cursor:
                cursor.execute("SELECT id FROM auth.users WHERE id = %s FOR UPDATE", [str(owner_id)])
                if cursor.fetchone() is None:
                    raise ValidationError({"detail": "La identidad autenticada no existe en Supabase Auth."})
            course = Course.objects.select_for_update().get(pk=course.pk, owner_id=owner_id, active=True)
            seen_codes = set(Student.objects.filter(owner_id=owner_id).exclude(external_code="").values_list("external_code", flat=True))
            for row_number, row in enumerate(reader, start=2):
                if row_number > 501:
                    errors.append({"row": row_number, "reason": "Límite de 500 filas por importación."})
                    break
                name = (row.get("name") or "").strip()[:180]
                email = (row.get("email") or "").strip().lower()[:254]
                code = (row.get("external_code") or "").strip()[:80]
                if not name:
                    skipped += 1; errors.append({"row": row_number, "reason": "Falta name."}); continue
                if email:
                    try: validate_email(email)
                    except DjangoValidationError:
                        skipped += 1; errors.append({"row": row_number, "reason": "Correo inválido."}); continue
                if code and code in seen_codes:
                    skipped += 1; errors.append({"row": row_number, "reason": "external_code duplicado."}); continue
                student = Student.objects.create(owner_id=owner_id, name=name, email=email, phone=(row.get("phone") or "").strip()[:32], external_code=code)
                Enrollment.objects.create(owner_id=owner_id, course=course, student=student, status="active")
                if code: seen_codes.add(code)
                created += 1
            record_audit(owner_id, "students.imported", "student_import", "csv", {"created": created, "skipped": skipped}, request=request)
            return Response({"created": created, "skipped": skipped, "errors": errors[:100]}, status=status.HTTP_200_OK)
        except UnicodeDecodeError as exc:
            raise ValidationError({"file": "El archivo debe estar codificado en UTF-8."}) from exc

class RubricViewSet(OwnerViewSet):
    queryset = Rubric.objects.all().prefetch_related("criteria__levels").order_by("-updated_at")
    serializer_class = RubricSerializer

    @action(detail=False, methods=["post"], url_path="create-with-criteria")
    @transaction.atomic
    def create_with_criteria(self, request):
        """Create a rubric, criteria and optional performance levels atomically."""
        raw_criteria = request.data.get("criteria")
        if not isinstance(raw_criteria, list) or not 2 <= len(raw_criteria) <= 20:
            raise ValidationError({"criteria": "Incluí entre 2 y 20 criterios."})
        rubric_serializer = RubricSerializer(data={
            "title": request.data.get("title", ""),
            "description": request.data.get("description", ""),
            "scale_type": request.data.get("scale_type", "both"),
        }, context={"request": request})
        rubric_serializer.is_valid(raise_exception=True)
        rubric = rubric_serializer.save(owner_id=request.user.id)

        for index, raw in enumerate(raw_criteria, start=1):
            if not isinstance(raw, dict):
                raise ValidationError({"criteria": f"El criterio {index} no tiene un formato válido."})
            criterion_serializer = RubricCriterionSerializer(data={
                "rubric": rubric.pk,
                "name": raw.get("name", ""),
                "description": raw.get("description", ""),
                "max_score": raw.get("max_score", 10),
                "weight": raw.get("weight", 1),
                "position": index,
            }, context={"request": request})
            criterion_serializer.is_valid(raise_exception=True)
            criterion = criterion_serializer.save(owner_id=request.user.id)
            if rubric.scale_type in {"levels", "both"}:
                default_levels = [
                    ("Inicial", "Requiere apoyo para demostrar el criterio.", 0),
                    ("En desarrollo", "Demuestra parte de lo esperado.", 1 / 3),
                    ("Logrado", "Cumple el criterio esperado.", 2 / 3),
                    ("Destacado", "Demuestra el criterio con profundidad o transferencia.", 1),
                ]
                supplied_levels = raw.get("levels")
                if not isinstance(supplied_levels, list) or len(supplied_levels) == 0:
                    supplied_levels = [
                        {"name": name, "description": desc, "score": round(float(criterion.max_score) * fraction, 2)}
                        for name, desc, fraction in default_levels
                    ]
                if len(supplied_levels) > 8:
                    raise ValidationError({"criteria": f"El criterio {index} no puede tener más de 8 niveles."})
                for level_index, raw_level in enumerate(supplied_levels, start=1):
                    if not isinstance(raw_level, dict):
                        raise ValidationError({"criteria": f"Un nivel del criterio {index} no tiene un formato válido."})
                    level_serializer = RubricLevelSerializer(data={
                        "criterion": criterion.pk,
                        "name": raw_level.get("name", ""),
                        "description": raw_level.get("description", ""),
                        "score": raw_level.get("score", 0),
                        "position": level_index,
                    }, context={"request": request})
                    level_serializer.is_valid(raise_exception=True)
                    level_serializer.save(owner_id=request.user.id)

        record_audit(request.user.id, "rubric.created", "rubric", rubric.id, {"criteria_count": len(raw_criteria), "scale_type": rubric.scale_type}, request=request)
        rubric = Rubric.objects.prefetch_related("criteria__levels").get(pk=rubric.pk, owner_id=request.user.id)
        return Response(RubricSerializer(rubric, context={"request": request}).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="generate", throttle_classes=[AIUserRateThrottle])
    def generate_action(self, request):
        title = str(request.data.get("title", ""))[:180]
        subject = str(request.data.get("subject", ""))[:120]
        level = str(request.data.get("level", ""))[:120]
        objectives = str(request.data.get("objectives", ""))[:5000]
        instructions = str(request.data.get("instructions", ""))[:8000]
        raw_question_prompts = request.data.get("question_prompts", [])
        if not isinstance(raw_question_prompts, list):
            raw_question_prompts = []
        question_prompts = [str(item)[:2000] for item in raw_question_prompts[:10] if str(item).strip()]
        try:
            count = int(request.data.get("count", 4))
        except (ValueError, TypeError) as exc:
            raise ValidationError({"count": "La cantidad debe ser un número entero entre 2 y 6."}) from exc
        if not 2 <= count <= 6:
            raise ValidationError({"count": "Solicitá entre 2 y 6 criterios para la rúbrica sugerida."})
        started = time.monotonic()
        context = {"title": title, "subject": subject, "level": level, "count": count, "question_count": len(question_prompts)}
        provider_config = active_ai_provider_config()
        try:
            reference_material = str(request.data.get("reference_material", ""))[:12000]
            result = async_to_sync(generate_rubric)(title=title, subject=subject, level=level, objectives=objectives, instructions=instructions, question_prompts=question_prompts, reference_material=reference_material, count=count, provider_config=provider_config)
            record_ai_generation(request.user.id, "generate_rubric", started, True, fingerprint(context), provider_config=provider_config)
        except Exception as exc:
            record_ai_generation(request.user.id, "generate_rubric", started, False, fingerprint(context), ai_error_code(exc), provider_config=provider_config)
            logger.warning("AI rubric generation failed (%s)", type(exc).__name__)
            return Response({"detail": _safe_ai_error_detail(exc, "No se pudo proponer la rúbrica. Revisá la configuración del proveedor de IA y volvé a intentar.")}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(result)

class QuestionViewSet(OwnerViewSet):
    queryset = Question.objects.all().select_related("assessment", "rubric")
    serializer_class = QuestionSerializer

    def get_queryset(self):
        return super().get_queryset().filter(assessment__owner_id=self.request.user.id)

    @transaction.atomic
    def perform_create(self, serializer):
        # The AI reservation also locks Assessment before Submission. Sharing this
        # lock order prevents a new/reordered question racing with prompt creation.
        requested_assessment = serializer.validated_data["assessment"]
        try:
            assessment = Assessment.objects.select_for_update().get(
                pk=requested_assessment.pk, owner_id=self.request.user.id,
            )
        except Assessment.DoesNotExist as exc:
            raise ValidationError("Evaluación no disponible.") from exc
        if assessment.status == "archived":
            raise ValidationError({"assessment": "No se pueden agregar consignas a una evaluación archivada."})
        if Submission.objects.filter(
            owner_id=self.request.user.id, assessment=assessment, status="processing",
        ).exists():
            raise ValidationError({"assessment": "No se pueden modificar las consignas mientras se procesa una corrección."})
        position = (Question.objects.filter(assessment=assessment).aggregate(max_position=Max("position"))["max_position"] or 0) + 1
        serializer.save(owner_id=self.request.user.id, assessment=assessment, position=position)
        # Treat a question-list change as an assessment-context update so in-flight
        # generation can detect a stale preflight snapshot.
        assessment.save(update_fields=["updated_at"])

    @transaction.atomic
    def perform_update(self, serializer):
        requested_question = serializer.instance
        assessment = Assessment.objects.select_for_update().get(
            pk=requested_question.assessment_id, owner_id=self.request.user.id,
        )
        if Submission.objects.filter(
            owner_id=self.request.user.id, assessment=assessment, status="processing",
        ).exists():
            raise ValidationError({"question": "No se pueden modificar consignas mientras se procesa una corrección."})
        question = Question.objects.select_for_update().get(
            pk=requested_question.pk, assessment=assessment, owner_id=self.request.user.id,
        )
        serializer.instance = question
        serializer.save()
        assessment.save(update_fields=["updated_at"])

    def destroy(self, request, *args, **kwargs):
        question = self.get_object()
        with transaction.atomic():
            assessment = Assessment.objects.select_for_update().get(
                pk=question.assessment_id, owner_id=request.user.id,
            )
            if Submission.objects.filter(
                owner_id=request.user.id, assessment=assessment, status="processing",
            ).exists():
                raise ValidationError({"question": "No se pueden modificar consignas mientras se procesa una corrección."})
            # select_for_update() no admite el LEFT JOIN de select_related('rubric'): se bloquea la fila sola.
            question = Question.objects.select_for_update().get(pk=question.pk, assessment=assessment, owner_id=request.user.id)
            if Submission.objects.filter(question=question).exists() or SubmissionAnswer.objects.filter(question=question).exists():
                return Response(
                    {"detail": "No se puede eliminar una pregunta con respuestas vinculadas. Podés editarla para nuevas evaluaciones o archivar la evaluación completa."},
                    status=status.HTTP_409_CONFLICT,
                )
            self.perform_destroy(question)
        return Response(status=status.HTTP_204_NO_CONTENT)

class RubricCriterionViewSet(OwnerViewSet):
    queryset = RubricCriterion.objects.all().select_related("rubric").prefetch_related("levels")
    serializer_class = RubricCriterionSerializer

    def get_queryset(self):
        return super().get_queryset().filter(rubric__owner_id=self.request.user.id)

    def perform_create(self, serializer):
        rubric = serializer.validated_data["rubric"]
        if str(rubric.owner_id) != str(self.request.user.id):
            raise ValidationError("Rúbrica no disponible.")
        serializer.save(owner_id=self.request.user.id)

class RubricLevelViewSet(OwnerViewSet):
    queryset = RubricLevel.objects.all().select_related("criterion__rubric")
    serializer_class = RubricLevelSerializer

    def get_queryset(self):
        return super().get_queryset().filter(criterion__rubric__owner_id=self.request.user.id)

    def perform_create(self, serializer):
        criterion = serializer.validated_data["criterion"]
        if str(criterion.owner_id) != str(self.request.user.id) or str(criterion.rubric.owner_id) != str(self.request.user.id):
            raise ValidationError("Criterio no disponible.")
        if serializer.validated_data["score"] > criterion.max_score:
            raise ValidationError({"score": "El puntaje del nivel no puede superar el máximo del criterio."})
        serializer.save(owner_id=self.request.user.id)
