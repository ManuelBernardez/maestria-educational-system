# Guía de validación, pendientes y rendimiento — MaestrIA v0.1.1

Esta guía acompaña la versión 0.1.1. Está escrita para usarla desde Windows/PowerShell, PostgreSQL/Supabase y GitHub Actions. Ejecutar primero en un entorno de prueba, no sobre producción.

## 1. Qué cambió en v0.1.1

- Se incorporó `GET /api/correction-workspace/`, que devuelve el listado liviano de evaluaciones y los datos de trabajo de una única evaluación: preguntas, entregas, correcciones, rúbricas, cursos, alumnos activos y matrículas del curso correspondiente. Se puede indicar `?assessment=ID`; una evaluación ajena o inexistente devuelve 404.
- La lista de evaluaciones ya no incluye el material de referencia completo ni las preguntas anidadas en cada fila. El detalle completo se carga únicamente para la evaluación seleccionada.
- La pantalla de detalle de una evaluación y el espacio de corrección aprovechan esa respuesta agrupada. Se evita descargar seis o siete colecciones globales y filtrar todo en el navegador.
- Al guardar material, generar/aprobar una corrección, la interfaz actualiza los datos afectados en lugar de volver a descargar todas las colecciones.
- `POST /api/rubrics/create-with-criteria/` crea la rúbrica, criterios y niveles en una transacción. Si algo falla, no queda una rúbrica a medio construir.
- La navegación docente se agrupa en Inicio, Preparar y corregir, Seguimiento y Organización. En la revisión siguen visibles la respuesta original, los criterios de la rúbrica, la propuesta, el texto de devolución y las acciones de aprobación/entrega, y se puede cambiar de entrega sin volver al listado.
- La edición inicial de rúbrica muestra nombre, criterio y puntaje; la descripción del criterio y el formato de escala quedan en secciones desplegables.
- `AppAuthGuard` ya no repite la consulta de sesión en cada cambio de ruta del panel. Los cambios de autenticación se siguen atendiendo mediante la suscripción.

## 2. Diagnóstico de lentitud según los logs aportados

### La mayor parte del tiempo mostrado es compilación de desarrollo

En el log inicial:

```text
GET / 200 in 4.0s (next.js: 3.5s, application-code: 460ms)
```

Next.js indica que 3,5 segundos correspondieron a su proceso de desarrollo/compilación de la ruta; el código de la aplicación aportó unos 460 ms. En la mayoría de las rutas siguientes hay tiempos de 38–88 ms.

En la ruta lenta:

```text
GET /app/evaluaciones/1 200 in 1288ms (next.js: 1255ms, application-code: 33ms)
```

el código de aplicación registrado aporta unos 33 ms; unos 1.255 ms se atribuyen al trabajo de Next.js al servir/compilar esa ruta. Esto no demuestra que todas las interacciones sean rápidas, pero sí indica que este registro concreto no apunta principalmente a lógica de negocio lenta.

La advertencia:

```text
Slow filesystem detected. The benchmark took 954ms.
...frontend/.next/dev
```

es una pista clara de que Next.js está teniendo un acceso lento a los archivos generados. El proyecto está situado en una unidad `F:` de Windows; por el log solo no se puede asegurar que sea una unidad de red, pero sí conviene comprobar si es un disco lento, externo, sincronizado o remoto.

### Qué hacer primero en Windows

1. **Mover el repositorio a un SSD local rápido**, por ejemplo una carpeta local que no sea una unidad de red ni una carpeta sincronizada. La carpeta `.next` contiene archivos de desarrollo y cachés que se consultan continuamente.
2. **Cerrar y volver a abrir VS Code y el servidor** después de mover el proyecto. En la terminal de frontend, detener `npm run dev` con `Ctrl+C` y ejecutar `npm run dev` de nuevo.
3. **No borrar `.next` en cada inicio.** Puede servir para resolver una caché corrupta, pero obliga a reconstruir y empeora el primer arranque normal.
4. Si el proyecto es de confianza y Microsoft Defender está analizando cada archivo del árbol de desarrollo, medir la diferencia con una exclusión limitada a esa carpeta. No desactivar la protección antivirus globalmente.
5. Si trabajás con WSL2, guardar el proyecto dentro del sistema de archivos Linux (por ejemplo `~/projects/maestria`) en vez de ejecutarlo directamente desde `/mnt/c`, `/mnt/f` u otra ruta montada de Windows.
6. Los cambios de Next.js a `jsx: "react-jsx"` y la inclusión de `.next/dev/types/**/*.ts` en `tsconfig.json` son configuraciones normales de Next actual; no explican esa demora y no conviene revertirlas para intentar acelerarla.

Documentación oficial útil:
- https://nextjs.org/docs/app/guides/local-development
- https://nextjs.org/docs/app/guides/lazy-loading

### Medir sin confundir desarrollo con producción

`next dev` compila rutas bajo demanda y su primera navegación es más lenta; la comparación válida para la velocidad del producto es una compilación optimizada y el servidor de producción local. Ejecutá desde `frontend/`:

```powershell
npm install
npm run lint
npm run typecheck
npm run build
npm run start
```

Si la compilación crea una configuración local en `.next`, no la incluyas en Git. Abrí luego la misma secuencia de páginas (inicio, resumen, evaluaciones, detalle y espacio de corrección) y compará con los tiempos de `next dev`.

**Importante:** el repositorio no incluye todavía `package-lock.json`. Hasta que se genere y se incorpore al control de versiones, `npm install` resuelve rangos permitidos por `package.json`, y la instalación no es completamente reproducible. En la máquina de desarrollo, una vez que el registro npm esté disponible, ejecutá `npm install`, revisá y confirmá `frontend/package-lock.json`; después el CI puede usar `npm ci`.

## 3. Qué se optimizó dentro de la aplicación

La pantalla de detalle antes pedía por separado evaluación, todas las preguntas, todas las rúbricas, todas las entregas, todos los alumnos, todas las correcciones y todos los cursos; filtraba las entregas y correcciones en el navegador. El espacio de corrección descargaba seis colecciones completas y volvía a hacerlo tras algunas operaciones.

Ahora se consulta una única ruta agregada y se limita el grueso de las entidades a la evaluación activa. La lista de evaluaciones omite el texto de referencia y las preguntas anidadas, lo que reduce el tamaño de las respuestas. La creación de rúbricas también pasa de hasta unas veinte peticiones secuenciales a una sola petición atómica.

La siguiente optimización debe basarse en mediciones de producción:

- Si el primer render y las navegaciones siguen lentos cuando `next dev` ya terminó de compilar, tomar tiempos del panel Network del navegador y separar: JavaScript descargado, hidratación, llamada API y consulta SQL.
- Registrar percentiles p50/p95 de `/api/correction-workspace/` con cantidades realistas de evaluaciones, estudiantes, entregas y rúbricas. No guardar respuestas de alumnos ni tokens en el log.
- Si la respuesta agregada crece demasiado, introducir paginación en alumnos/entregas y una ruta específica para las entregas de la cola. No implementar cachés, Redis o colas asíncronas hasta tener una medición que demuestre la necesidad.
- Si el proveedor real de IA es lento, medirlo por separado del tiempo de carga de la pantalla. Una corrección puede tardar más por latencia/coste del proveedor; la interfaz debe mostrar progreso y evitar repetir solicitudes al hacer clic varias veces.

## 4. Comprobación del backend y migraciones

Abrir PowerShell en el directorio del proyecto:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python manage.py showmigrations core
python manage.py migrate --plan
python manage.py makemigrations --check --dry-run
python manage.py check
python manage.py test
```

Si no hay entorno virtual, crearlo e instalar dependencias de desarrollo:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

La base local de pruebas debe ser una base aislada. Para Supabase, ejecutar el archivo `database/diagnostico-pendientes-v0.1.1.sql` desde SQL Editor. La primera sección lista las migraciones registradas y la segunda consulta el esquema de `reference_material` incluso si la columna no existe.

Interpretación de `reference_material`:

- La migración `0005_assessment_reference_material` aparece como aplicada y la columna existe: el campo está alineado.
- La migración está pendiente y la columna no existe: en un entorno confirmado, revisar `migrate --plan` y aplicar `python manage.py migrate` desde backend.
- La migración aparece aplicada y la columna no existe: hay divergencia entre historial y esquema. No usar `--fake`, no eliminar tablas y no ejecutar un `ALTER TABLE` improvisado. Hacer backup, comparar el SQL de la migración con la base real y preparar una reparación revisada.

## 5. Prueba de aislamiento entre dos docentes

Usar dos cuentas de prueba de Supabase (A y B) y datos ficticios. No probarlo con trabajos reales de estudiantes.

1. Con A, crear curso, evaluación, alumno, rúbrica, entrega y corrección.
2. Con B, consultar los listados y `/api/correction-workspace/`. B no debe recibir ninguna entidad de A.
3. Con B, copiar el ID de evaluación/entrega/corrección de A y consultar o intentar modificar el recurso por ID. Debe devolver 404 o denegación equivalente, sin datos de A.
4. Repetir el intento con IDs de rúbrica, pregunta, matrícula y respuesta individual. Verificar también los endpoints de exportación y envío.
5. Repetir en sentido inverso, porque los errores de propiedad pueden ser asimétricos.
6. Revisar que el navegador no contenga la clave `service_role`, claves privadas ni secretos del proveedor de IA. Las claves `anon`/publishable de Supabase son públicas por diseño, pero las políticas RLS y las reglas del backend siguen siendo necesarias.

Se adjunta SQL de diagnóstico para localizar relaciones cuyo `owner_id` no coincide con el propietario del registro relacionado. Las consultas deben devolver cero filas. Si devuelven datos, no borrarlos en bloque; clasificar cada registro y diseñar una reparación controlada.

## 6. RLS y permisos en Supabase: cómo tomar una decisión segura

El backend Django valida el JWT y filtra cada queryset por `owner_id`. `database/supabase-rls.sql` agrega otra capa de defensa para los roles de navegador. Antes de ejecutarlo o modificarlo:

- Confirmar qué usuario de base de datos utiliza Django (`DATABASE_URL`) y si es un rol que puede omitir RLS. No incluir la URI en reportes.
- Comprobar las columnas `relrowsecurity`/`relforcerowsecurity`, las políticas reales y los permisos `anon`/`authenticated` con el SQL diagnóstico.
- Si la aplicación no necesita acceder directamente a tablas `core_*` desde el cliente Supabase, preferir que el cliente no tenga esos permisos; la API Django es la vía de acceso a los datos privados.
- No habilitar políticas nuevas sin comprobar todas las relaciones, ya que una política mal planteada puede tanto filtrar datos como bloquear operaciones legítimas. La función `auth.uid()` representa el usuario de Supabase solo cuando la consulta se ejecuta en el contexto de ese JWT; no debe asumirse que funciona igual para una conexión administrativa de Django.

## 7. Duplicados de cursos y códigos de alumnos

La validación de nombre de curso ya compara `name__iexact`, pero la restricción de base actual `uniq_course_name_per_owner` distingue mayúsculas/minúsculas. La base puede aceptar un duplicado si dos peticiones concurrentes pasan la validación al mismo tiempo.

Propuesta:

1. Ejecutar las consultas de duplicados del SQL diagnóstico.
2. Decidir si `Curso A` y `curso a` deben considerarse el mismo curso y si `ABC`/`abc` debe considerarse el mismo código de alumno.
3. Si se decide que sí, resolver los duplicados existentes preservando matrículas y evaluaciones.
4. En una migración revisada, cambiar la restricción por una restricción basada en `Lower("name")` por propietario y añadir una normalización consistente a los códigos. No aplicar esa migración antes de limpiar los conflictos.

## 8. Decisiones de producto pendientes y propuesta

### A. Reabrir una corrección ya aprobada

**Propuesta:** no sobrescribir el resultado aprobado. Ofrecer una acción explícita “Reabrir para corregir”, pedir motivo, registrar una revisión con usuario/fecha y conservar el resultado que se envió anteriormente. La entrega no debe actualizarse a “final” hasta la nueva aprobación. Requiere una decisión de UX y una prueba de auditoría antes de implementarlo.

### B. Envío por correo o WhatsApp

**Propuesta:** el canal debe indicar claramente tres estados: listo para enviar, envío confirmado por proveedor y no enviado/error. No mostrar “enviado” si solo se creó un enlace de WhatsApp o si no está configurado SMTP. El envío solo debe permitir correcciones aprobadas y datos de contacto voluntariamente registrados. En v0.1.1 deben probarse los estados devueltos por cada integración con cuentas de prueba.

### C. Privacidad y retención de datos

**Propuesta:** antes de un piloto real, definir por escrito qué contenido se envía a cada proveedor de IA, en qué región se procesa, tiempo de retención, borrado/exportación, roles autorizados y cómo se informa al docente. Usar datos ficticios para pruebas técnicas. No incorporar nombres u otros datos identificatorios a los prompts si no son necesarios para evaluar la respuesta.

### D. Límites de uso de IA

**Propuesta:** mantener los límites actuales de entradas/longitud y medir coste, tasa de error y latencia. Antes de agregar un sistema de trabajos en cola, confirmar si las correcciones de grupos completos hacen superar los límites HTTP o generan timeouts. Si ocurre, mover solo esa operación a tareas de fondo con estado visible y posibilidad de reintento seguro.

### E. Navegación principal

**Propuesta:** usar el “Espacio de corrección” como lugar principal del trabajo cotidiano. Mantener “Evaluaciones” para planificar/editar consignas, “Entregas y devoluciones” para consultar el historial y “Cursos/Alumnos” como organización. Evitar duplicar la misma acción de aprobar en varios lugares si no se puede garantizar que usen la misma lógica y mensajes.

## 9. Criterios de aceptación para cerrar v0.1.1

- [ ] `python manage.py check` y `python manage.py makemigrations --check --dry-run` terminan sin errores.
- [ ] `python manage.py test` pasa, incluidos los nuevos tests de `correction_workspace` y creación atómica de rúbricas.
- [ ] En el frontend pasan `npm run lint`, `npm run typecheck` y `npm run build`.
- [ ] `package-lock.json` está versionado y el CI puede usar `npm ci`.
- [ ] La consulta SQL de relaciones devuelve cero filas o cada anomalía quedó documentada con plan de reparación.
- [ ] La prueba de dos cuentas confirma que no hay lectura/escritura cruzada, incluidos exportaciones y entregas.
- [ ] El tablero de red demuestra que el workspace hace una llamada agregada inicial y no descarga entregas de otras evaluaciones.
- [ ] Se midió la carga en producción local (`npm run build` + `npm run start`), por separado de `npm run dev`.
- [ ] Un docente que no conoce la app puede crear una rúbrica sencilla, cargar una entrega, revisar criterios/puntaje/devolución, aprobar y exportar sin navegar entre categorías para completar cada paso.

## 10. Alcance y limitaciones de esta versión

Esta actualización añade código y regresiones automatizadas, pero no se declara “lista para producción” hasta ejecutar las pruebas en el entorno de desarrollo con dependencias instaladas. La computadora que generó este paquete no tiene Django instalado y no pudo completar una instalación de paquetes de frontend; por eso los tests/build deben correrse en la máquina local o en CI. No se debe interpretar una revisión estática como evidencia de que las integraciones externas ya funcionan.
