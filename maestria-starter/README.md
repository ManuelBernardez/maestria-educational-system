# MaestrIA — base inicial del MVP

Plataforma para asistir a docentes en la creación de evaluaciones y la corrección de respuestas abiertas mediante IA, manteniendo siempre la decisión final en manos del docente.

> Estado: scaffold inicial para que el equipo comience a trabajar. No está listo para datos reales ni constituye aún una aplicación completa de producción.

## Stack
- Frontend: Next.js + React + TypeScript + CSS Modules/variables CSS.
- Backend: FastAPI + Pydantic + Psycopg.
- Datos y autenticación: Supabase (PostgreSQL + Supabase Auth; Storage si se habilitan archivos).
- IA: adaptador desacoplado para un proveedor compatible con la API de OpenAI; proveedor configurable por entorno.
- Pruebas: pytest y Playwright (frontend por incorporar al pipeline).

## Estructura
- `frontend/`: interfaz web.
- `backend/`: API, reglas de negocio e integraciones.
- `backend/migrations/`: SQL versionado.
- `specs/`: requisitos y decisiones.
- `docs/`: procedimientos y documentación del equipo.

## Puesta en marcha
### Backend
1. Crear entorno virtual desde `backend/`.
2. Instalar dependencias: `pip install -r requirements.txt`.
3. Copiar `.env.example` a `backend/.env` y completar las variables.
4. Aplicar `backend/migrations/001_initial.sql` sobre la base PostgreSQL de desarrollo.
5. Ejecutar `uvicorn app.main:app --reload` desde `backend/`.
6. Abrir `/docs` para explorar la API.

### Frontend
1. Entrar a `frontend/`.
2. Instalar dependencias con `npm install`.
3. Copiar `.env.example` a `frontend/.env.local` y configurar Supabase.
4. Ejecutar `npm run dev`.

## Seguridad: límites de esta base
- Usar exclusivamente datos ficticios/anonimizados mientras se completa la revisión de seguridad y privacidad.
- No almacenar secretos en el frontend ni en el repositorio.
- Las rutas de negocio deben validar el token y filtrar cada recurso por el usuario autenticado.
- El flujo de IA debe producir una propuesta revisable; nunca una calificación definitiva automática.
- No habilitar correo/WhatsApp real hasta configurar credenciales, consentimiento, plantillas/reglas del proveedor y pruebas de entrega.

## Próximos hitos
1. Configurar Supabase Auth y probar verificación de identidad.
2. Completar CRUD de evaluaciones/preguntas/rúbricas y aislamiento por usuario.
3. Implementar entregas y correcciones con estados y trazabilidad.
4. Añadir proveedor de IA real y benchmark de respuestas.
5. Exportación y adaptadores de correo/WhatsApp.
6. Pruebas, despliegue y revisión previa al piloto real.
