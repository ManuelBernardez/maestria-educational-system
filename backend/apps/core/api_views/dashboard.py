from .common import (
    AllowAny,
    Assessment,
    AssessmentListSerializer,
    AssessmentWorkspaceSerializer,
    AuditEvent,
    ContactMessage,
    ContactUserRateThrottle,
    Correction,
    CorrectionCriterionResult,
    CorrectionSerializer,
    CorrectionSummarySerializer,
    Count,
    Course,
    CourseDashboardSerializer,
    CourseOptionSerializer,
    Decimal,
    Enrollment,
    EnrollmentSerializer,
    NotFound,
    OuterRef,
    Prefetch,
    PublicContactMessageSerializer,
    Question,
    QuestionSerializer,
    Response,
    Rubric,
    RubricCriterion,
    RubricLevel,
    RubricOptionSerializer,
    RubricSerializer,
    Student,
    StudentOptionSerializer,
    StudentSerializer,
    Submission,
    SubmissionAnswer,
    SubmissionListSerializer,
    SubmissionSerializer,
    Subquery,
    Substr,
    UserProfile,
    active_ai_provider_config,
    api_view,
    clear_mock_practice_corrections,
    courses_with_dashboard_counts,
    logger,
    os,
    permission_classes,
    record_audit,
    send_mail,
    status,
    throttle_classes,
    transaction,
)

@api_view(["GET"])
def dashboard_overview(request):
    """Load the dashboard in one authenticated request with compact owner-scoped data."""
    owner_id = request.user.id
    course_rows = list(courses_with_dashboard_counts(owner_id, active_only=True).order_by("-updated_at", "name"))
    courses_data = CourseDashboardSerializer(course_rows, many=True).data

    assessment_rows = Assessment.objects.filter(owner_id=owner_id).select_related("course").only(
        "id", "title", "subject", "level", "status", "course_id", "updated_at",
        "course__id", "course__name",
    ).order_by("-updated_at")
    assessments_data = AssessmentListSerializer(assessment_rows, many=True).data

    # Aggregate by course and state instead of transferring every correction row.
    correction_groups = list(
        Correction.objects.filter(
            owner_id=owner_id,
            submission__owner_id=owner_id,
            submission__assessment__owner_id=owner_id,
        )
        .values("submission__assessment__course_id", "status")
        .annotate(total=Count("id"))
    )
    course_correction_counts = [
        {"course_id": item["submission__assessment__course_id"], "status": item["status"], "count": item["total"]}
        for item in correction_groups
    ]
    pending_count = sum(item["total"] for item in correction_groups if item["status"] == "pending_review")
    approved_count = sum(item["total"] for item in correction_groups if item["status"] == "approved")

    summary = {
        "courses": len(course_rows),
        "assessments": sum(1 for item in assessments_data if item["status"] != "archived"),
        "students": Student.objects.filter(owner_id=owner_id, active=True).count(),
        "submissions": Submission.objects.filter(owner_id=owner_id).count(),
        "pending_corrections": pending_count,
        "approved_corrections": approved_count,
        "recent_activity": list(
            AuditEvent.objects.filter(owner_id=owner_id)
            .order_by("-created_at")
            .values("id", "event_type", "object_type", "object_id", "detail", "created_at")[:8]
        ),
    }
    return Response({
        "courses": courses_data,
        "assessments": assessments_data,
        "course_correction_counts": course_correction_counts,
        "summary": summary,
    })

@api_view(["GET"])
def dashboard_summary(request):
    owner = request.user.id
    corrections = Correction.objects.filter(owner_id=owner)
    approved = corrections.filter(status="approved")
    pending = corrections.filter(status="pending_review")
    return Response({
        "courses": Course.objects.filter(owner_id=owner, active=True).count(),
        "assessments": Assessment.objects.filter(owner_id=owner).exclude(status="archived").count(),
        "students": Student.objects.filter(owner_id=owner, active=True).count(),
        "submissions": Submission.objects.filter(owner_id=owner).count(),
        "pending_corrections": pending.count(),
        "approved_corrections": approved.count(),
        "recent_activity": list(AuditEvent.objects.filter(owner_id=owner).values("id", "event_type", "object_type", "object_id", "detail", "created_at")[:8]),
    })

@api_view(["GET"])
def audit_events(request):
    events = AuditEvent.objects.filter(owner_id=request.user.id).values(
        "id", "event_type", "object_type", "object_id", "detail", "created_at"
    )[:100]
    return Response(list(events))

@api_view(["POST"])
@transaction.atomic
def seed_demo_dataset(request):
    """Create a small, clearly synthetic dataset owned by the signed-in teacher.

    The endpoint is idempotent: repeated clicks open the same practice dataset
    instead of duplicating students, classes, rubrics, assessments or submissions.
    No real student personal data is included, and the endpoint never calls an AI.
    """
    owner_id = request.user.id
    marker = AuditEvent.objects.filter(
        owner_id=owner_id,
        event_type="demo.dataset_seeded",
        object_id="photosynthesis-v1",
    ).first()
    if marker:
        detail = marker.detail or {}
        assessment_id = detail.get("assessment_id")
        assessment = Assessment.objects.filter(owner_id=owner_id, pk=assessment_id).first()
        if assessment:
            clear_mock_practice_corrections(owner_id, assessment)
            # Older practice datasets may have carried a filename label despite never uploading a file.
            Submission.objects.filter(owner_id=owner_id, assessment=assessment).exclude(source_filename="").update(source_filename="")
            return Response({
                "created": False,
                "course_id": assessment.course_id,
                "assessment_id": assessment.id,
                "submission_count": Submission.objects.filter(owner_id=owner_id, assessment=assessment).count(),
                "message": "El ejemplo ya estaba cargado. Abrí la evaluación para continuar practicando.",
            })

    course, _ = Course.objects.get_or_create(
        owner_id=owner_id,
        name="Ejemplo MaestrIA · Ciencias Naturales",
        defaults={
            "subject": "Ciencias Naturales",
            "level": "Secundaria · 2.º año",
            "academic_year": "2026",
            "description": "Curso ficticio para practicar el flujo de evaluación y corrección. No representa estudiantes reales.",
            "active": True,
        },
    )
    if not course.active:
        course.active = True
        course.save(update_fields=["active", "updated_at"])

    sample_students = [
        ("Alma Torres · Ejemplo", "DEMO-FOTO-001"),
        ("Bruno Díaz · Ejemplo", "DEMO-FOTO-002"),
        ("Malena Ruiz · Ejemplo", "DEMO-FOTO-003"),
    ]
    students = []
    for display_name, external_code in sample_students:
        student, _ = Student.objects.get_or_create(
            owner_id=owner_id,
            external_code=external_code,
            defaults={"name": display_name, "email": "", "phone": "", "active": True},
        )
        if not student.active:
            student.active = True
            student.save(update_fields=["active", "updated_at"])
        Enrollment.objects.get_or_create(
            owner_id=owner_id, course=course, student=student,
            defaults={"status": "active"},
        )
        students.append(student)

    rubric, _ = Rubric.objects.get_or_create(
        owner_id=owner_id,
        title="Ejemplo MaestrIA · Rúbrica de fotosíntesis",
        defaults={
            "description": "Criterios ficticios para evaluar una explicación científica breve.",
            "scale_type": "both",
        },
    )
    criterion_specs = [
        ("Explica el proceso", "Relaciona luz, agua y dióxido de carbono con la producción de glucosa.", 4.0,
         [("Logrado", "Explica los elementos y su relación", 4.0), ("En desarrollo", "Menciona parte del proceso", 2.0), ("Inicial", "No explica el proceso o incluye errores centrales", 0.0)]),
        ("Comprende la transformación de energía y materia", "Distingue la energía de la luz y la materia usada para formar glucosa.", 3.0,
         [("Logrado", "Distingue energía y materia", 3.0), ("En desarrollo", "Reconoce solo una parte", 1.5), ("Inicial", "Confunde energía y materia", 0.0)]),
        ("Explica su importancia", "Relaciona la fotosíntesis con la vida de la planta y otros seres vivos.", 3.0,
         [("Logrado", "Explica la importancia para plantas y ecosistemas", 3.0), ("En desarrollo", "Explica una sola consecuencia", 1.5), ("Inicial", "No justifica su importancia", 0.0)]),
    ]
    criteria = []
    for position, (name, description, maximum, levels) in enumerate(criterion_specs, start=1):
        criterion, _ = RubricCriterion.objects.get_or_create(
            owner_id=owner_id, rubric=rubric, position=position,
            defaults={"name": name, "description": description, "max_score": Decimal(str(maximum)), "weight": Decimal("1.000")},
        )
        # Keep demo dataset repeatable; only create levels when the criterion has none.
        if not criterion.levels.exists():
            for level_position, (level_name, level_description, score) in enumerate(levels, start=1):
                RubricLevel.objects.create(
                    owner_id=owner_id, criterion=criterion, name=level_name,
                    description=level_description, score=Decimal(str(score)), position=level_position,
                )
        criteria.append(criterion)

    assessment, _ = Assessment.objects.get_or_create(
        owner_id=owner_id,
        title="Ejemplo MaestrIA · ¿Cómo funciona la fotosíntesis?",
        course=course,
        defaults={
            "subject": "Ciencias Naturales",
            "level": "Secundaria · 2.º año",
            "objectives": "Explicar la fotosíntesis e identificar la materia y la energía que intervienen.",
            "instructions": "Respondé con tus palabras. Explicá qué toma la planta del ambiente, qué produce y por qué el proceso es importante.",
            "reference_material": "Material ficticio de práctica: durante la fotosíntesis, las plantas usan energía de la luz para formar glucosa a partir de agua y dióxido de carbono. En el proceso se libera oxígeno. La glucosa almacena energía química y aporta materia para el crecimiento.",
            "status": "ready",
        },
    )
    question, _ = Question.objects.get_or_create(
        owner_id=owner_id, assessment=assessment, position=1,
        defaults={
            "prompt": "Explicá qué ocurre durante la fotosíntesis y por qué es importante para las plantas y otros seres vivos.",
            "expected_answer": "Una respuesta sólida explica el uso de luz, agua y dióxido de carbono para producir glucosa; reconoce que se libera oxígeno; y vincula la glucosa con el crecimiento y las cadenas alimentarias.",
            "question_type": "open",
            "max_score": Decimal("10.00"),
            "rubric": rubric,
        },
    )
    if question.rubric_id != rubric.id:
        question.rubric = rubric
        question.save(update_fields=["rubric", "updated_at"])

    sample_answers = [
        "La fotosíntesis permite que las plantas fabriquen glucosa usando energía de la luz, agua y dióxido de carbono. En el proceso liberan oxígeno. La glucosa les sirve para crecer y también sostiene las cadenas alimentarias, porque otros seres vivos se alimentan de plantas o de animales que las comen.",
        "Las plantas usan la luz del sol y el agua para crecer. La fotosíntesis les permite fabricar alimento, aunque no recuerdo qué papel tiene el dióxido de carbono. También puede ser importante porque libera oxígeno.",
        "Las plantas comen tierra por las raíces y la convierten en oxígeno. La luz solo les da calor; la fotosíntesis ocurre cuando las hojas toman minerales del suelo.",
    ]
    submissions = []
    for student, answer_text in zip(students, sample_answers):
        submission, _ = Submission.objects.get_or_create(
            owner_id=owner_id, assessment=assessment, student=student,
            defaults={
                "question": question,
                "student_name": student.name,
                "answer_text": answer_text,
                "source_type": "text",
                "status": "pending",
            },
        )
        submissions.append(submission)

    record_audit(owner_id, "demo.dataset_seeded", "demo_dataset", "photosynthesis-v1", {
        "course_id": course.id,
        "assessment_id": assessment.id,
        "submission_ids": [item.id for item in submissions],
    }, request=request)
    return Response({
        "created": True,
        "course_id": course.id,
        "assessment_id": assessment.id,
        "submission_count": len(submissions),
        "message": "Ejemplo de práctica creado: un curso, tres estudiantes ficticios, una evaluación, una rúbrica y tres respuestas para revisar.",
    }, status=status.HTTP_201_CREATED)

@api_view(["GET"])
def correction_workspace(request):
    """Return selected-evaluation data; summary=1 defers answer and correction details."""
    owner_id = request.user.id
    summary_mode = request.query_params.get("summary") == "1"
    # Una sola consulta para el selector y la evaluación elegida (antes eran dos).
    assessment_list = list(
        Assessment.objects.filter(owner_id=owner_id).select_related("course").order_by("-updated_at")
    )
    requested_id = request.query_params.get("assessment")
    selected = None
    if requested_id:
        try:
            requested_pk = int(requested_id)
        except (TypeError, ValueError):
            requested_pk = None
        selected = next((item for item in assessment_list if item.pk == requested_pk), None)
        if selected is None:
            raise NotFound("Evaluación no disponible.")
    elif not summary_mode:
        # Preserve the legacy full-workspace behavior for internal callers that
        # explicitly request the non-summary representation.
        selected = next((item for item in assessment_list if item.status != "archived"), None) or (assessment_list[0] if assessment_list else None)

    assessments = AssessmentListSerializer(assessment_list, many=True).data
    if summary_mode and selected is None:
        # The first visit only needs the selector data. Do not query rosters,
        # rubrics, questions, submissions, corrections or enrollments until a
        # teacher chooses an assessment (or opens a deep link with its ID).
        courses = CourseOptionSerializer(
            Course.objects.filter(owner_id=owner_id, active=True).order_by("name"), many=True
        ).data
        return Response({
            "assessments": assessments,
            "selected_assessment": None,
            "students": [],
            "courses": courses,
            "rubrics": [],
            "questions": [],
            "submissions": [],
            "corrections": [],
            "enrollments": [],
            "ai_provider": (active_ai_provider_config() or {}).get("provider") or os.getenv("AI_PROVIDER", "mock").strip().lower(),
        })
    # Do not load teacher rosters or full rubric structures on the empty state.
    # When an assessment has a course, fetch only its active enrolled students.
    students = []
    courses = []
    rubrics = []
    selected_data = None
    questions = []
    submissions = []
    corrections = []
    enrollments = []
    if selected is not None:
        student_qs = Student.objects.filter(owner_id=owner_id, active=True)
        if selected.course_id:
            student_qs = student_qs.filter(
                enrollments__owner_id=owner_id,
                enrollments__course_id=selected.course_id,
                enrollments__course__owner_id=owner_id,
                enrollments__status="active",
            ).distinct()
        if summary_mode:
            # The queue needs identifying fields only, not every enrollment for each student.
            students = StudentOptionSerializer(
                student_qs.order_by("name").only("id", "name", "email", "phone", "active"), many=True
            ).data
        else:
            student_qs = student_qs.prefetch_related(
                Prefetch(
                    "enrollments",
                    queryset=Enrollment.objects.filter(
                        owner_id=owner_id, course__owner_id=owner_id, student__owner_id=owner_id,
                    ).select_related("course"),
                )
            )
            students = StudentSerializer(
                student_qs.order_by("name"), many=True, context={"request": request}
            ).data
        courses = CourseOptionSerializer(
            Course.objects.filter(owner_id=owner_id, active=True).order_by("name"), many=True
        ).data
        rubric_queryset = Rubric.objects.filter(owner_id=owner_id).prefetch_related(
            Prefetch("criteria", queryset=RubricCriterion.objects.order_by("position", "id"))
        ).order_by("title")
        if summary_mode:
            rubrics = RubricOptionSerializer(rubric_queryset, many=True).data
        else:
            rubrics = RubricSerializer(
                Rubric.objects.filter(owner_id=owner_id).prefetch_related("criteria__levels").order_by("title"),
                many=True, context={"request": request},
            ).data
        selected_data = AssessmentWorkspaceSerializer(selected, context={"request": request}).data
        selected_questions = Question.objects.filter(owner_id=owner_id, assessment=selected).select_related("rubric").order_by("position", "id")
        questions = QuestionSerializer(selected_questions, many=True, context={"request": request}).data
        selected_submissions = Submission.objects.filter(owner_id=owner_id, assessment=selected).select_related(
            "assessment", "student", "question"
        ).order_by("-created_at")
        if summary_mode:
            # Keep list rows narrow: question prompts and assessment instructions are
            # delivered by their dedicated serializers, not duplicated per submission.
            selected_submissions = selected_submissions.select_related(None).select_related("student").only(
                "id", "assessment_id", "question_id", "student_id", "student_name",
                "source_type", "source_filename", "status", "created_at",
                "student__id", "student__name",
            )
            first_answer_preview = Subquery(
                SubmissionAnswer.objects.filter(
                    submission_id=OuterRef("pk"), owner_id=owner_id,
                    question__owner_id=owner_id,
                ).order_by("question__position", "id").annotate(
                    preview=Substr("answer_text", 1, 301),
                ).values("preview")[:1]
            )
            selected_submissions = selected_submissions.annotate(
                answer_preview=Substr("answer_text", 1, 301),
                first_answer_preview=first_answer_preview,
            ).defer("answer_text")
            submissions = SubmissionListSerializer(selected_submissions, many=True, context={"request": request}).data
        else:
            selected_submissions = selected_submissions.prefetch_related(
                Prefetch(
                    "answers",
                    queryset=SubmissionAnswer.objects.filter(
                        owner_id=owner_id,
                        question__owner_id=owner_id,
                        submission__owner_id=owner_id,
                    ).select_related("question").order_by("question__position", "id"),
                )
            )
            submissions = SubmissionSerializer(selected_submissions, many=True, context={"request": request}).data
        corrections_qs = Correction.objects.filter(
            owner_id=owner_id,
            submission__owner_id=owner_id,
            submission__assessment__owner_id=owner_id,
            submission__assessment=selected,
        ).order_by("-updated_at")
        if summary_mode:
            corrections_qs = corrections_qs.select_related(
                "submission__assessment__course", "submission__student",
            ).only(
                "id", "owner_id", "submission_id", "status", "provider", "total_score", "created_at",
                "submission__id", "submission__student_id", "submission__student_name",
                "submission__assessment_id", "submission__assessment__title",
                "submission__assessment__subject", "submission__assessment__course_id",
                "submission__assessment__course__id", "submission__assessment__course__name",
                "submission__student__id", "submission__student__name",
            )
            corrections = CorrectionSummarySerializer(corrections_qs, many=True).data
        else:
            corrections_qs = corrections_qs.select_related(
                "submission__assessment", "submission__student"
            ).prefetch_related(
                Prefetch(
                    "criterion_results",
                    queryset=CorrectionCriterionResult.objects.filter(
                        owner_id=owner_id, correction__owner_id=owner_id,
                    ).select_related("question"),
                )
            )
            corrections = CorrectionSerializer(corrections_qs, many=True, context={"request": request}).data
        if selected.course_id and not summary_mode:
            enrollments = EnrollmentSerializer(
                Enrollment.objects.filter(owner_id=owner_id, course_id=selected.course_id, status="active")
                .filter(course__owner_id=owner_id, student__owner_id=owner_id)
                .select_related("course", "student"), many=True, context={"request": request},
            ).data

    return Response({
        "assessments": assessments,
        "selected_assessment": selected_data,
        "students": students,
        "courses": courses,
        "rubrics": rubrics,
        "questions": questions,
        "submissions": submissions,
        "corrections": corrections,
        "enrollments": enrollments,
        "ai_provider": (active_ai_provider_config() or {}).get("provider") or os.getenv("AI_PROVIDER", "mock").strip().lower(),
    })

@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    return Response({"status": "ok", "service": "maestria-api"})

@api_view(["GET"])
@permission_classes([AllowAny])
def client_config(request):
    """Expose only browser-safe Supabase Auth settings; never expose service-role/JWT secrets."""
    return Response({
        "supabase_url": os.getenv("SUPABASE_URL", "").rstrip("/"),
        "supabase_anon_key": os.getenv("SUPABASE_ANON_KEY", ""),
    })

@api_view(["GET"])
def current_user_profile(request):
    """Return the authenticated identity's MaestrIA role and scoped memberships."""
    from ..permissions import active_memberships
    profile = UserProfile.objects.filter(user_id=request.user.id, status="active").first()
    if profile is None:
        # Normally rejected by JWT authentication; keep the endpoint fail-closed
        # in case it is reused with another authentication backend in the future.
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied("La cuenta no tiene un perfil activo en MaestrIA.")
    memberships = list(
        active_memberships(request.user).select_related("institution")
        .values("id", "institution_id", "institution__name", "role", "status")
    )
    return Response({
        "user_id": str(request.user.id),
        "email": getattr(request.user, "email", "") or (profile.email if profile else ""),
        "full_name": profile.full_name,
        "avatar": profile.avatar_data,
        "role": profile.role,
        "status": profile.status,
        "memberships": memberships,
    })


# La imagen llega ya recortada y reducida por el navegador (256x256); el límite deja
# margen para PNG sin comprimir de más. Debe coincidir con user_profile_avatar_data_valid.
MAX_AVATAR_CHARS = 200_000
_AVATAR_SIGNATURES = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/webp": (b"RIFF",),
}


def _validated_avatar(value):
    """Data URL de imagen válida (tipo declarado = contenido real) o ValidationError."""
    import base64
    import binascii
    from rest_framework.exceptions import ValidationError

    text = str(value or "").strip()
    if len(text) > MAX_AVATAR_CHARS:
        raise ValidationError({"avatar": "La imagen es demasiado grande. Probá con otra foto."})
    header, _, payload = text.partition(",")
    mime = header[len("data:"):-len(";base64")] if header.startswith("data:") and header.endswith(";base64") else ""
    if mime not in _AVATAR_SIGNATURES or not payload:
        raise ValidationError({"avatar": "Formato no admitido. Usá una imagen JPG, PNG o WebP."})
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        raise ValidationError({"avatar": "La imagen está dañada. Probá con otra foto."})
    if not raw.startswith(_AVATAR_SIGNATURES[mime]) or (mime == "image/webp" and raw[8:12] != b"WEBP"):
        raise ValidationError({"avatar": "El contenido del archivo no corresponde a una imagen válida."})
    return text


@api_view(["PUT", "DELETE"])
def current_user_avatar(request):
    """Guarda (PUT {"avatar": data URL}) o quita (DELETE) la foto de perfil propia."""
    avatar = "" if request.method == "DELETE" else _validated_avatar((request.data or {}).get("avatar"))
    updated = UserProfile.objects.filter(user_id=request.user.id, status="active").update(avatar_data=avatar)
    if not updated:
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied("La cuenta no tiene un perfil activo en MaestrIA.")
    record_audit(request.user.id, "profile.avatar_updated" if avatar else "profile.avatar_removed", "user_profile", str(request.user.id), {"chars": len(avatar)}, request=request)
    return Response({"avatar": avatar})

@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([ContactUserRateThrottle])
def contact(request):
    """Persist public messages; privileged workflow fields are never accepted."""
    serializer = PublicContactMessageSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = getattr(request, "user", None)
    user_id = user.id if user and getattr(user, "is_authenticated", False) else None
    # The message and its authenticated audit event commit together. SMTP is
    # deliberately performed after the transaction so it cannot hold DB locks.
    with transaction.atomic():
        message = ContactMessage.objects.create(
            name=serializer.validated_data["name"],
            email=serializer.validated_data["email"],
            subject=serializer.validated_data["subject"],
            message=serializer.validated_data["message"],
            category=serializer.validated_data.get("category", "general"),
            source="public_web",
            user_id=user_id,
        )
        if user_id:
            record_audit(
                user_id, "contact_message.created", "contact_message", message.pk,
                {"category": message.category, "source": "public_web"}, request=request,
            )
    # Email notification is best-effort and independent from database persistence.
    if os.getenv("CONTACT_NOTIFY_EMAIL") and os.getenv("DEFAULT_FROM_EMAIL"):
        try:
            send_mail(
                f"Contacto MaestrIA: {message.subject}",
                f"Nombre: {message.name}\nCorreo: {message.email}\n\n{message.message}",
                os.getenv("DEFAULT_FROM_EMAIL"), [os.getenv("CONTACT_NOTIFY_EMAIL")], fail_silently=True,
            )
        except Exception:
            logger.warning("Contact notification failed")
    return Response({"detail": "Mensaje recibido. Gracias por escribirnos."}, status=status.HTTP_201_CREATED)
