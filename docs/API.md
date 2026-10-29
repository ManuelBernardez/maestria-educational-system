# API de MaestrIA

Base local: `http://127.0.0.1:8000/api/`. Salvo `/health/` y el formulario público `/contact/`, los endpoints requieren `Authorization: Bearer <Supabase access token>`.

| Método / ruta | Uso | Estado |
|---|---|---|
| `GET /health/` | Salud básica de proceso/API; no valida DB | Público |
| `POST /contact/` | Formulario público con validación, honeypot y rate limit | Público limitado |
| `GET /dashboard/overview/` | Panel docente compacto en una lectura: cursos, evaluaciones, conteos de correcciones y métricas | Autenticado |
| `GET /dashboard/summary/` | Contadores y actividad reciente del usuario | Autenticado |
| `GET /audit-events/` | Últimos eventos del docente | Autenticado |
| `/courses/` | Listar, crear, editar y archivar cursos | Propietario |
| `/enrollments/` | Matricular/desmatricular estudiantes en cursos | Propietario y relaciones propias |
| `/students/` | Listar/crear/editar/desactivar estudiantes | Propietario |
| `POST /students/import-csv/` | Importar CSV, máximo 2 MB y 500 filas | Propietario, limitado |
| `/assessments/` | CRUD de evaluaciones | Propietario |
| `POST /assessments/{id}/import-reference/` | Extraer texto de PDF/DOCX/TXT/MD para usarlo como material de referencia | Propietario, límite de tamaño y texto |
| `POST /assessments/{id}/generate-questions/` | Proponer preguntas editables, entre 1 y 10 | Propietario, rate limit IA |
| `/rubrics/` | CRUD de rúbricas | Propietario |
| `POST /rubrics/generate/` | Proponer criterios de rúbrica | Propietario, rate limit IA |
| `/rubric-criteria/`, `/rubric-levels/` | Criterios y niveles de desempeño | Propietario y relaciones propias |
| `/questions/` | CRUD de preguntas | Propietario y evaluación propia |
| `/submissions/` | Crear/listar/editar entregas | Propietario y evaluación propia |
| `POST /submissions/import-file/` | TXT/MD/DOCX/PDF con texto extraíble; 5 MB, 50 páginas PDF, 50.000 caracteres | Propietario, autenticado |
| `POST /submissions/{id}/generate-correction/` | Generar propuesta de corrección | Propietario, rate limit IA |
| `/submission-answers/` | Respuestas a preguntas individuales | Propietario y evaluación propia |
| `/corrections/` | Consultar correcciones e historial resumido | Propietario |
| `POST /corrections/{id}/approve/` | Validar/cerrar propuesta con acción explícita | Propietario |
| `GET /corrections/{id}/export/` | Exportar la propuesta o el resultado final en Markdown | Propietario |

`GET /correction-workspace/?summary=1` sin `assessment` devuelve solamente datos de selectores; con `assessment=<id>` devuelve información compacta de esa evaluación. La UI solicita los detalles completos de la entrega/corrección al seleccionarla.

El endpoint de generación de rúbrica acepta `instructions`, `question_prompts` (lista de hasta 10 consignas) y `reference_material`; estos campos aportan contexto para una propuesta editable. El cliente debe revisar los criterios antes de persistirlos.

Compartir por correo/WhatsApp e imprimir a PDF son acciones del cliente y no tienen endpoints de envío/exportación PDF en la API.

Los IDs son internos. El backend nunca confía en un `owner_id` provisto en el cuerpo. Se aplican validaciones de propiedad también sobre recursos relacionados; aun así, el aislamiento debe verificarse con pruebas de dos cuentas antes de producción.

## Flujo recomendado

1. Crear un curso (`POST /courses/`).
2. Registrar estudiantes (`POST /students/`) y asociarlos (`POST /enrollments/`).
3. Crear evaluación incluyendo `course` (`POST /assessments/`).
4. Proponer preguntas (`POST /assessments/{id}/generate-questions/`) y persistir las aceptadas vía `/questions/`.
5. Crear rúbrica/criterios/niveles; asociar la rúbrica a las preguntas.
6. Crear entrega con texto o importar un archivo; crear respuestas por pregunta si el examen tiene múltiples consignas.
7. Generar propuesta; revisar y aprobar desde el endpoint de aprobación.
8. Desde la interfaz, preparar el texto para correo o WhatsApp, copiarlo o imprimirlo para guardar como PDF. El backend solo ofrece exportación Markdown; no envía mensajes ni genera PDF.

## Estados y confianza

- La IA en `mock` devuelve ejemplos y los marca como `demo`. Nunca deben utilizarse como calificaciones reales ni enviarse al estudiante.
- La generación y aprobación se registran sin almacenar prompts/respuestas completos en la tabla de operaciones de IA.
- La aprobación valida que las puntuaciones estén dentro de los máximos y que cada evidencia no vacía esté contenida literalmente en el texto cargado.
- La API no proporciona a estudiantes un portal ni hace exámenes online en este MVP.
