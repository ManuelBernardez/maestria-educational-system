# MaestrIA v1.0.3 — contrato del flujo docente

## Flujo principal inspeccionado

| Etapa | Frontend | Backend | Resultado de auditoría estática |
|---|---|---|---|
| Crear curso | `features/forms.js` → `POST courses/` | `CourseViewSet` | Implementado |
| Cargar estudiantes | `POST students/` o `POST students/import-csv/` | `StudentViewSet` | Implementado; alta individual asocia el curso y CSV usa matrícula indicada |
| Crear evaluación | `POST assessments/` | `AssessmentViewSet` | Implementado |
| Crear consignas | `POST questions/` | `QuestionViewSet` | Implementado; editor vuelve a cargar las consignas |
| Registrar entregas | `POST submissions/` o `POST submissions/import-file/` | `SubmissionViewSet` | Implementado para texto y archivo |
| Generar corrección IA | `POST submissions/{id}/generate-correction/` | `SubmissionViewSet.generate_correction_action` | Implementado; depende de credenciales, política de privacidad y proveedor disponibles |
| Editar y aprobar | `POST corrections/{id}/approve/` | `CorrectionViewSet.approve` | Implementado; valida puntajes, evidencia y motivo de cambio, y conserva revisión |
| Compartir devolución | correo, WhatsApp, copiar o imprimir | Cliente, sólo para estado `approved` | Implementado como preparación manual; no envía correos automáticamente |

## Guía inicial

Los controles se enlazan una sola vez al contenedor persistente `#quickstart-root`. Cada paso reemplaza el contenido interno, pero no el nodo que posee el listener. Esto evita perder los manejadores al regenerar la vista. `X` y «Lo veo después» cierran sin marcar la guía como completada; «Siguiente» y «Anterior» cambian de paso; «Ir a cursos» completa la guía y navega.

## Estructura del frontend

```text
frontend/
├── html/       # páginas públicas y espacio-docente/
├── css/        # hojas de estilo
├── js/         # cliente, entrypoints y módulos por dominio
└── assets/     # imágenes, iconos y recursos estáticos
```

Django sirve las páginas HTML desde `frontend/html`. WhiteNoise recoge `frontend/css` y `frontend/js` con los prefijos estáticos `css/` y `js/`; las imágenes permanecen en `frontend/assets`.

## Límites de la validación

Los verificadores estáticos prueban rutas locales, imports/exports, sintaxis JavaScript, imports Python y presencia de contratos frontend/backend. No prueban una sesión real, la escritura en Supabase, una respuesta real de Gemini, entrega efectiva de correo ni la interacción en todos los navegadores. Para cerrar la validación funcional hace falta ejecutar el smoke test manual en staging con una cuenta docente de prueba y datos sintéticos.
