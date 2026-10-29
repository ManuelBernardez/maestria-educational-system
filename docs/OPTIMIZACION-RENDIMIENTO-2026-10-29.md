# MaestrIA — optimización de rendimiento (2026-10-29)

## Objetivo

Reducir el trabajo repetido en la navegación autenticada y el volumen de datos descargado por las pantallas de correcciones, sin cambiar de stack ni añadir infraestructura que todavía no está justificada por mediciones. Esta nota incluye la segunda pasada solicitada tras revisar la captura de DevTools del 2026-10-29.

## Segunda pasada: primera carga y navegación recurrente

- Se incorporó `GET /dashboard/overview/`, una respuesta compacta con cursos, evaluaciones, correcciones agrupadas por curso/estado y métricas del docente. La página `/app` sustituye cuatro lecturas paralelas por una única lectura de contenido. Los cursos del sidebar siguen usando su endpoint pequeño independiente.
- Se refactorizó el conteo de estudiantes y evaluaciones por curso mediante subconsultas correlacionadas separadas para evitar la multiplicación de filas entre matrículas y evaluaciones.
- `GET /correction-workspace/?summary=1` sin `assessment` ya no elige automáticamente la primera evaluación ni consulta estudiantes, rúbricas, preguntas, entregas o correcciones. Devuelve solo metadatos de selector. Al seleccionar una evaluación, la página pide su versión compacta; los detalles de una entrega se siguen cargando bajo demanda.
- El detalle del workspace evita la consulta independiente de matrículas en modo resumido, porque la lista de estudiantes ya viene restringida a matrículas activas del curso seleccionado.
- El modal de compartir se importa de forma diferida y solo se monta cuando se abre.
- Todas las secciones `<details>` aparecen cerradas al montar la página. El formulario de creación de curso conserva apertura controlada por el usuario y comienza en `false`; no se abre automáticamente cuando el curso está vacío ni por una query string.
- Se añadió el encabezado de diagnóstico `Server-Timing: django;dur=...` a respuestas `/api/`. En DevTools permite separar el tiempo total dentro de Django de la espera de red/browser sin registrar tokens ni contenido privado.
- Las rutas del allowlist de caché compartida fallan cerradas si no se puede verificar la sesión local; no reintentan `getSession()` en un segundo paso potencialmente bloqueante ni envían una petición anónima accidental. La caché sigue limitada a GETs definidos, keyed por usuario, corta y se invalida después de mutaciones exitosas.

### Concurrencia y seguridad

No se modificó el ciclo de generación de correcciones con IA, sus operaciones transaccionales, los bloqueos `select_for_update`, el límite de concurrencia `AI_MAX_CONCURRENT_ANSWERS` ni el semáforo asíncrono. Las rutas de datos nuevas usan `request.user.id` y filtros de propietario; se agregó un test que exige autenticación para `/dashboard/overview/` y otro que comprueba aislamiento entre dos propietarios. La asincronía de generación sigue resolviéndose con la implementación actual y no se agregó un broker/worker sin evidencia de saturación.

## Cambios implementados

### Frontend

- `frontend/src/components/AppAuthGuard.tsx`: la sesión inicial se verifica al montar el layout privado; los cambios de ruta ya no vuelven a activar la pantalla de bloqueo ni reinstalan el listener de autenticación.
- `frontend/src/app/app/layout.tsx`: el menú lateral y la barra superior se montan una sola vez como parte del layout de `/app`. Se quitaron las copias de `AppSidebar` y de `app-shell` de las páginas anidadas.
- `frontend/src/lib/api.ts`: las lecturas compartidas reutilizan el token de acceso resuelto para la clave de caché y no vuelven a consultar Supabase Auth antes de hacer la petición. Se incorporó a las lecturas compartidas el selector compacto de cursos. Se mantiene una caché breve, por usuario, solo para GETs concretos; no se cachean mutaciones ni se comparte información entre cuentas.
- Los selectores de cursos usan `/courses/?nav=1`, sin conteos agregados ni descripciones largas.
- `frontend/src/app/app/cursos/[id]/page.tsx` solicita evaluaciones y correcciones filtradas por curso en vez de obtener todos los registros y filtrarlos en el navegador.
- `frontend/src/app/app/espacio-correccion/page.tsx`: pide el modo resumido del espacio de trabajo. La cola utiliza una vista previa acotada de 300 caracteres y una selección obtiene la entrega y corrección completas bajo demanda. Las peticiones de selección anteriores se abortan cuando el usuario elige otra entrega.
- `frontend/src/app/app/correcciones/page.tsx`: la lista usa el serializer resumido, las respuestas completas se solicitan al expandir cada devolución y el modal de compartir se carga de forma diferida. La exportación sigue usando su endpoint específico.

### Backend

- `backend/apps/core/serializers.py`: nuevos serializers pequeños para la navegación por cursos y para la selección de rúbricas sin descriptores de niveles.
- `backend/apps/core/views.py`: `/courses/?nav=1` evita agregaciones de matrículas/evaluaciones; los endpoints de evaluaciones y correcciones aceptan `?course=<id>`; `/corrections/?summary=1` devuelve solo campos de identificación y estado.
- `/correction-workspace/?summary=1` no incluye cuerpos de respuesta completos, JSON de propuestas ni resultados finales en la cola. Las respuestas se recortan en la consulta de base de datos, no se precargan las respuestas anidadas y la lista de estudiantes evita traer matrículas anidadas. La consulta selecciona solo las columnas necesarias para la lista.
- `backend/apps/core/test_workspace.py`: se añadieron pruebas para el payload reducido, el selector de cursos y el filtrado por curso.

## Comportamientos que cambian deliberadamente

- En la lista compacta de correcciones, la búsqueda local incluye estudiante, evaluación, curso y materia. Ya no incluye el texto completo de la retroalimentación ni el resumen de la propuesta, porque esas cargas se difieren al abrir una devolución. El placeholder refleja esos campos de búsqueda.
- El puntaje compacto muestra el puntaje registrado inicialmente. El denominador y el desglose por criterio se muestran cuando se carga el detalle.
- En el espacio de corrección, la búsqueda usa nombre, archivo y una vista previa de la respuesta, no el documento completo.

## Validaciones realizadas

- `python -m compileall -q backend`: correcto.
- Transpilación sintáctica de los 46 archivos `.ts`/`.tsx` del frontend mediante TypeScript global: cero diagnósticos de sintaxis.
- Inspección estática: el único `<details>` con prop `open` está controlado por `createFormOpen`, inicializado en `false`; no quedan paneles marcados para abrirse de forma automática.
- Encabezado de temporización añadido para que la próxima medición pueda separar tiempo de servidor de tiempo extremo a extremo.
- Inspección estática: las páginas anidadas no conservan un segundo `AppSidebar` o `app-shell`.

## Validaciones pendientes / limitaciones

No fue posible ejecutar las pruebas Django ni un `manage.py check`: Django y las dependencias del backend no están instaladas en este entorno. Tampoco fue posible hacer `npm run typecheck`/`npm run build`: el directorio `node_modules` no está presente y el registro npm no estaba accesible para instalar dependencias. La transpilación sintáctica no sustituye a la comprobación de tipos ni a una build completa.

No se ejecutaron consultas contra una instancia de Supabase ni se midieron Core Web Vitals o latencias de producción. Antes de desplegar, ejecutar las validaciones indicadas abajo y probar navegación, selección de entregas, aprobación, exportación y compartir una devolución aprobada.

## Verificación local recomendada

Backend, desde `backend/`:

```bash
python manage.py check
python manage.py test apps.core.test_workspace
python manage.py makemigrations --check --dry-run
```

Frontend, desde `frontend/`:

```bash
npm ci
npm run typecheck
npm run lint
npm run build
npm run start
```

Después, medir en Chrome DevTools la primera carga y las navegaciones posteriores, en particular `/app`, `/app/cursos/<id>`, `/app/correcciones` y `/app/espacio-correccion`. En cada respuesta `/api/`, inspeccionar `Server-Timing: django;dur=...`: si el valor es bajo frente al tiempo de Network, el cuello de botella está fuera de la ejecución Django (red, preflight, proxy o inicialización del cliente); si es alto, medir ORM/SQL y región de PostgreSQL. Comparar desarrollo con producción (`npm run build` y `npm run start`), tamaño de respuestas, cantidad de solicitudes, y Core Web Vitals.

## Siguiente fase condicionada a métricas

No se agregó Celery/Redis ni se migró de Django a FastAPI/Flask: ambas decisiones añaden operación y complejidad. Si las mediciones muestran que las solicitudes síncronas de IA ocupan los workers y retrasan otras rutas, el próximo cambio debería desacoplar generación y procesamiento masivo mediante trabajos de fondo. Si el cuello de botella se concentra en la base, primero ajustar consultas e índices con planes reales; si se concentra en JavaScript, revisar bundles y componentes cliente con el build de producción.
