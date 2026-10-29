# Revisión de solicitudes, integridad y seguridad — 2026-10-28

## Diagnóstico del log

Los `GET ... 200` indican que esas respuestas sí se completaron correctamente. `OPTIONS ... 200 0` es el preflight CORS habitual del navegador cuando una petición cross-origin incluye `Authorization`; no es, por sí mismo, un error.

El patrón de peticiones repetidas coincide con el código del frontend:

- `AppSidebar` consulta `GET /courses/` al montarse.
- El panel (`src/app/app/page.tsx`) vuelve a consultar `GET /courses/`, además de evaluaciones, resumen de correcciones y resumen general.
- Otras páginas también solicitan `/courses/` al cargar.
- Los componentes abortan las solicitudes en su limpieza de `useEffect`. Si la conexión ya empezó, el servidor de desarrollo de Django puede registrar `Broken pipe` cuando el cliente cierra el socket.

React explica que en desarrollo Strict Mode repite un ciclo de setup/cleanup de los Effects como comprobación adicional. Esto puede hacer visible el patrón durante el desarrollo sin representar un fallo del endpoint en sí. Referencia: https://react.dev/reference/react/useEffect

El fragmento de log por sí solo no prueba qué llamada individual fue cancelada, pero las llamadas duplicadas y los `AbortController` del código son consistentes con el patrón observado. No hay indicios en esos tamaños de respuesta de un payload excesivo ni evidencia de que `Broken pipe` sea un error SQL.

## Cambios aplicados

1. **Lecturas compartidas en el cliente API.** Para `GET /courses/`, `/assessments/`, `/corrections/?summary=1` y `/dashboard/summary/`, se comparte la solicitud en curso por usuario y se conserva una respuesta correcta durante 1,2 segundos. Las señales siguen cancelando la espera del componente, pero no interrumpen la petición compartida que otro componente puede necesitar. Se usa una lista cerrada de endpoints, no una caché global para todas las rutas. Las mutaciones exitosas invalidan la caché y los errores nunca se cachean.
2. **Nombres de curso sin duplicados por mayúsculas/minúsculas.** Se reemplaza la restricción exacta por una restricción de base de datos sobre `LOWER(name)` y `owner_id`. Además, el `CourseViewSet` convierte un conflicto concurrente de unicidad en un error de validación legible, en lugar de un `500`.
3. **Códigos externos de estudiante.** El serializer comprueba el código antes de guardar y el alta traduce el conflicto concurrente de base de datos a un error de validación. La importación CSV usa un savepoint por fila para que un conflicto de unicidad puntual no deje la transacción completa en estado fallido.
4. **Pruebas de regresión añadidas.** Se cubren el rechazo de un nombre de curso que solo difiere en mayúsculas/minúsculas y el rechazo de un código externo de estudiante duplicado sin dejar una matrícula parcial.

### Migración de base de datos

Se agregó `0009_course_name_case_insensitive_unique.py`. Antes de cambiar la restricción, verifica si ya hay cursos de la misma cuenta cuyos nombres solo difieren por mayúsculas/minúsculas. Si los encuentra, aborta con un mensaje claro y **no renombra ni elimina datos**. En ese caso hay que resolver esos nombres y volver a ejecutar la migración.

Ejecutar en el entorno correspondiente:

```bash
cd backend
python manage.py migrate
```

## Revisión de SQL e integridad

- En las vistas del backend no se encontraron usos de `.raw()`, `RawSQL`, `.extra()` ni ejecución directa de SQL. Las consultas de ejecución usan Django ORM, que parametriza los valores suministrados por el usuario. Referencia: https://docs.djangoproject.com/en/6.1/topics/security/#sql-injection-protection
- El SQL manual encontrado está en migraciones de esquema. Los nombres de tablas/columnas/constraints provienen de tuplas constantes definidas en el código, y los valores de consulta se pasan como parámetros; no se construye SQL con texto de la petición.
- `OwnerViewSet` filtra por el `owner_id` derivado del JWT autenticado, y los ViewSets relacionales aplican filtros de propiedad adicionales. La migración de consistencia entre tenants ya establece claves foráneas compuestas para varias relaciones.
- Ya existen restricciones de unicidad para matrículas (`course`, `student`), códigos externos no vacíos por cuenta, posiciones de consignas/criterios y respuestas por pregunta/entrega. Los nombres de rúbricas, evaluaciones y estudiantes no se fuerzan globalmente como únicos, porque pueden repetirse legítimamente; la política de duplicados debe basarse en identificadores reales, no solo en nombres.

## Validación realizada y límites

- `python -m compileall -q backend`: correcto para la sintaxis de los módulos Python.
- Búsqueda estática de SQL dinámico en el código de ejecución: sin usos encontrados fuera de migraciones.
- Se ejecutó el `tsc` global, pero este entorno no tiene instaladas las dependencias del proyecto (`next`, `react` y tipos de Node). Por esa razón el chequeo completo de TypeScript no es concluyente; los diagnósticos de `api.ts` restantes corresponden a `process` sin los tipos de Node.
- `npm ci` no terminó dentro del tiempo de ejecución disponible. Django/DRF tampoco están instalados en este entorno, así que no pude ejecutar la suite Django, `manage.py check`, `makemigrations --check`, ni validar la migración contra la base de datos real.

## Riesgo residual / siguiente mejora

`backend/apps/core/views.py` contiene alrededor de 1.500 líneas. No es una sola clase gigante, pero sí concentra varias áreas funcionales en un mismo módulo. Conviene separar vistas por dominio (cursos/alumnos, evaluaciones/rúbricas, entregas/correcciones) en un cambio dedicado, conservando imports de compatibilidad y con la suite backend ejecutándose antes y después. No mezclé esa reorganización amplia con este arreglo porque no fue posible correr las pruebas de integración en este entorno.
