# Historial de cambios — MaestrIA

Registro de versiones del sistema, de la más reciente a la más antigua. Hasta la v1.1.3 este historial formaba parte del `README.md`. Las auditorías técnicas de cada etapa están en `docs/` y en `docs/auditoria/` (por ejemplo, `AUDITORIA-SUPABASE-2026-11-09.md`).

## v1.1.3

- **Estáticos en desarrollo:** `runserver` servía `/assets/` sin `Cache-Control`; el navegador cacheaba los módulos por heurística y, tras cada cambio, mezclaba JavaScript viejo con CSS nuevo (la interfaz quedaba a medio actualizar: filtros que no respondían, tarjetas con la respuesta completa, botones faltantes). Ahora los sirve WhiteNoise (`whitenoise.runserver_nostatic`) con el mismo `no-cache` que producción. `config/static_files.py` corrige además la búsqueda en Windows: con los prefijos `css/` y `js/` de `STATICFILES_DIRS`, WhiteNoise no encontraba el código fuente y servía la copia de `backend/staticfiles/`, que puede estar desactualizada. En producción no cambia nada (sin finders ni autorefresh).
- **Versión de assets 1.1.3:** los navegadores que ya habían cargado la 1.1.2 reciben `Clear-Site-Data` una vez y descartan los módulos guardados.
- **Nueva entrega:** el botón también está en la barra de revisión del paso 3 (elegir una entrega con propuesta abre ese paso).
- **Avisos y textos:** el aviso «Cargá una entrega para poder revisar» se cierra con una ×; los indicadores del panel docente ya no muestran «Ver pendientes / aprobadas / devoluciones» (queda como tooltip); la guía de uso no muestra «Paso N de M» ni la línea «La guía está disponible desde el botón de ayuda».

## v1.1.2

- **Panel docente:** los indicadores (Por revisar, Revisadas, Tiempo ahorrado) son botones que abren el historial de correcciones filtrado por ese estado.
- **Desplegables exclusivos:** en todo el sitio sólo queda abierto un desplegable por grupo; al abrir otro, el anterior se pliega (`frontend/js/modules/core/disclosure.js`; en el sitio público, `<details name>`).
- **Curso:** cuatro desplegables (Estudiantes, Evaluaciones, Entregas, Correcciones); se quitó «Resumen del curso» y la descripción del curso pasó debajo del título. Cada paso del recorrido muestra en su círculo la cantidad de elementos de su desplegable, abre ese desplegable al hacer clic y comparte su color.
- **Correcciones:** un desplegable por curso (acordeón); dentro, chips para filtrar por evaluación cuando el curso tiene más de una. Cada fila se titula con el nombre del estudiante.
- **Espacio de trabajo más limpio:** sin rótulos «Paso N ·» repetidos, marca de agua ni nota al pie; la portada sólo muestra estado y curso. Paso 1: «Apuntes y materiales» forma parte del formulario de contexto (debajo de los objetivos, arriba de la rúbrica); la rúbrica queda a la vista y agregar/reemplazar material sólo aparece al elegir un archivo. Paso 2: privacidad en una línea (sin desplegable), sin barra de progreso ni contador duplicados; con un archivo adjunto el cuadro de texto se bloquea; renglones más tenues en la respuesta del estudiante. La lista de entregas muestra nombre y legajo (sin avatar), arranca filtrada por «Pendientes» y el filtro es un selector (Pendientes / Aprobadas / Todas). Al editar una entrega, «Nueva entrega» la deselecciona y deja el formulario listo para cargar otra. Paso 3: «Criterios» primero, sin índice de secciones, «Expandir todo», selector de entrega duplicado ni «Sugerido por la IA» en cada criterio; la columna izquierda muestra la respuesta y, plegada, la consigna.
- **Archivos e IA:** los archivos se procesan en memoria y sólo se guarda el texto extraído (más nombre y tipo). Ahora el DOCX incluye el texto de las tablas; los TXT en Windows‑1252 se leen bien; se eliminan bytes NUL que PostgreSQL rechazaba (error 500); un PDF con contraseña da un mensaje claro. Con Gemini, el contexto de la corrección se cortaba en 8.000 caracteres y la IA perdía el material de referencia (y a veces la consigna): ahora la consigna va primero y el tope es 42.000. La «respuesta esperada» de cada consigna se guardaba pero nunca llegaba a la IA: ahora forma parte del contexto de la corrección. La interfaz avisa que la IA lee los primeros 12.000 caracteres del material. Si la corrección fallaba después de subir un archivo, el reintento quedaba bloqueado: corregido.
- **Menú lateral:** sin scroll horizontal; textos y botones se ajustan al ancho (también contraído y en móvil).
- **Valores por defecto:** «Mis materias» se muestra como lista compacta y el tema inicial es el claro (el oscuro queda sólo si se elige).
- **Guía de uso:** se abre sola la primera vez que la persona entra o mientras no tenga cursos creados (una vez por sesión). Sin íconos decorativos.
- **Revisión pedagógica (`?view=correction`):** no muestra el proveedor de IA; cada criterio es un plegable (acordeón, el primero abierto). Un campo inválido dentro de un plegable cerrado se abre al enviar, e «Imprimir» despliega todo antes de imprimir.
- **Portadas:** se quitaron las etiquetas superiores (`view-kicker`) de los encabezados de sección.

## v1.1.0 – v1.1.1

- **Identidad visual y espacio de trabajo (v1.1.0):** rediseño "Cuaderno de cátedra" del espacio docente y del panel de administración.
- **Caché de despliegue (v1.1.1):** JS, CSS y CSV se revalidan siempre (`no-cache`) y el primer HTML de cada versión envía `Clear-Site-Data` para que el navegador no mezcle módulos viejos y nuevos. La versión de assets vive en `FRONTEND_ASSETS_VERSION` (`backend/config/settings.py`) y debe coincidir con `package.json`.
- **Validación integral:** "Guardar contexto" también guarda la consigna en edición; `/api/*` inexistente responde 404 JSON; la importación de estudiantes por CSV acepta encabezados en español; `conftest.py` impide correr las pruebas contra Supabase.
- **Revisión por consigna:** en entregas con varias consignas, "Revisar y aprobar" muestra cada respuesta por separado, indica a qué consigna pertenece cada criterio y resalta la cita en la respuesta que la IA corrigió.
- **Mensajes de error:** los errores de validación del backend que llegaban como lista (`["…"]`) o anidados se muestran con su texto en lugar de "HTTP 400".
- **Base de datos:** `db/maestria_schema_v2_contract_alignment.sql` alinea instalaciones nuevas con lo que espera el backend. En producción ya se aplicó el rango de timeout 5–85 s (2026-11-07). *(Desde 2026-11-09 la instalación limpia usa `db/maestria_schema.sql`.)*

## v1.0.9

- **Espacio de trabajo docente:** se incorpora en JavaScript nativo el flujo de tres etapas Contexto → Entrega → Revisar, incluyendo objetivos, instrucciones, consignas, propuestas de consignas, material de referencia, selección de estudiante y rúbrica, importación de archivos, cola filtrable, revisión de criterios, aprobación, exportación y opciones de compartir.
- **Contrato de backend:** se reutilizan las rutas y payloads ya existentes (`correction-workspace/`, `assessments/`, `questions/`, `submissions/`, `corrections/`). No se agrega una API paralela ni se cambia el backend para simular funciones.
- **Rendimiento y asincronía:** la primera carga consulta el resumen liviano del espacio; los detalles completos de entrega/corrección se obtienen al seleccionarlos. Las lecturas cancelables evitan que respuestas fuera de orden sobrescriban la selección actual y un bloqueo síncrono evita duplicar operaciones de IA/importación.
- **Navegación:** se mantiene una SPA HTML/CSS/JS por módulos, ahora con vistas enlazables (`?view=...`) y soporte de historial del navegador. El estado compartido del flujo de revisión permanece dentro de una misma vista sin fragmentarse entre páginas.
- **Accesibilidad y seguridad:** formularios nativos etiquetados, estados `aria-live`, foco visible, controles semánticos, mensajes de error y validación en cliente; la aprobación real y los controles de autorización siguen siendo responsabilidad del backend.
- **Mantenimiento:** se retiran copias estáticas antiguas que no forman parte del frontend servido por Django, se conserva el directorio de imágenes, se versiona el CSS para invalidar caché y se agregan verificaciones del contrato del workspace.
- **Base recibida:** el ZIP `maestria-starter.zip` declara la versión `1.0.8`, no `1.0.7`. Para no degradar ni sobrescribir cambios posteriores, esta entrega se construye sobre esa base y se publica como `1.0.9`.

## v1.0.7

- **IA y privacidad:** se conserva el bloqueo *fail-closed* para Gemini/OpenAI. El error ahora explica qué revisión debe realizar el responsable antes de habilitar el procesamiento externo. Nunca se activa el permiso automáticamente ni desde la interfaz docente.
- **Estados HTTP de IA:** correcciones, rúbricas y consignas devuelven `503` cuando falta una aprobación o una configuración local; los errores reales del proveedor continúan devolviendo `502`.
- **Puntajes y decimales:** la presentación limita la visualización a dos decimales significativos (por ejemplo, `10`, `8,5` o `8,25`) y oculta la escala de almacenamiento de PostgreSQL. Los valores persistidos no se redondean ni modifican.
- **Identidad visual del espacio docente:** sidebar verde bosque, fondo cuadriculado tipo papel, superficies cálidas en modo claro y paneles profundos en modo oscuro, manteniendo el selector de tema y el diseño responsive.
- **Caché:** versión de assets actualizada a `1.0.7` para evitar que se reutilice el CSS anterior.
- **Verificación:** comprobaciones estáticas de frontend, sintaxis JS/Python e inspección de las rutas de error/configuración. La generación IA real requiere configurar claves y autorizaciones en el entorno desplegado; no puede darse por probada sin esas credenciales.

## v1.0.6

- Cursos: el alta siempre crea el curso activo; se quitó el selector de estado del formulario. Archivar/reactivar continúa disponible después de crear el curso. El backend también fuerza `active=True` en altas por API.
- Evaluaciones: el editor recibe y conserva `reference_material`, evitando que una edición descarte material de referencia importado.
- Consignas: al editar una consigna ya no se reenvía la relación `assessment`, que es inmutable; la relación se envía solamente al crearla.
- Números: se normalizan puntajes, máximos, ponderaciones y valores de formularios para eliminar ceros decimales redundantes, sin agregar decimales que el usuario no ingresó.
- Generación de consignas: los errores de configuración/política de IA (incluido Gemini sin nivel pago confirmado) devuelven `503` y un mensaje accionable; los errores reales del proveedor siguen devolviendo `502`. No se desactiva la protección que impide enviar trabajos docentes/estudiantiles a Gemini Free.
- Verificación: `npm run check:frontend`, compilación Python (`compileall`), verificación de imports y pruebas unitarias de formato numérico. No se ejecutó una prueba E2E contra Render/Supabase; el entorno de revisión no tiene Django instalado ni conexión a la base desplegada.

## v1.0.5

El frontend se organiza en cuatro carpetas: `frontend/html`, `frontend/css`, `frontend/js` y `frontend/assets`. Django sirve las páginas HTML desde `html/`; WhiteNoise publica CSS/JS bajo `/assets/css/` y `/assets/js/`, y las imágenes bajo `/assets/`. `npm run check:frontend` ejecuta los chequeos de referencias, módulos y contrato del flujo docente.

Auditoría estática del tramo «generar corrección → editar → aprobar → compartir» (sin Django ni red en el entorno de revisión: los cambios están verificados por sintaxis y pruebas puras, no por una corrida E2E).

- IA/Gemini: tope de espera por llamada de 18 s → 85 s (por defecto 60 s, `AI_TIMEOUT_SECONDS`); antes una corrección con varios criterios daba 502 por timeout.
- IA/Gemini: `maxOutputTokens` 1800 → 8192 en correcciones (4096 en consignas/rúbricas). Los modelos con razonamiento consumen esos tokens y la salida JSON llegaba truncada.
- IA: un reintento ante 429/5xx/error de conexión; se tolera JSON envuelto en ```; el error indica si fue truncado por tokens.
- Evidencia literal: la validación tolera espacios, saltos de línea, comillas y guiones tipográficos, y guarda el texto exacto de la fuente. Antes se descartaba evidencia válida y la aprobación fallaba con «debe coincidir literalmente» si la entrega tenía `\r\n`.
- Mensajes de error accionables para 429 (cuota), 401/403 (clave), 400/404 (modelo), 5xx y timeout.
- Aprobar: se eliminó una lectura redundante; la entrega queda en estado «review» en pantalla tras generar.
- Compartir: el correo (`mailto:`) recorta cuerpos largos y copia el texto completo al portapapeles; «Copiar» tiene alternativa si no hay API de portapapeles.
- Imprimir/PDF: nueva hoja `@media print` (antes se imprimía el menú y los botones).
- Caché: la ruta de respaldo de Django también envía `no-cache` para JS/CSS/CSV.
- Despliegue: gunicorn `--timeout 150` (render.yaml y Dockerfile) y `AI_TIMEOUT_SECONDS=60`.
- Tests puros nuevos: `backend/apps/core/test_ai_evidence.py`.

### Segunda tanda v1.0.5

- **Ponderaciones (crítico):** la nota final ahora aplica los pesos: cada criterio aporta logro relativo × peso/Σpesos, expresado sobre la suma de máximos (igual a la suma simple si pesos y máximos son iguales). Se aplica al generar y al aprobar, por consigna. Los criterios de la propuesta guardan su `weight`. La pantalla de rúbrica muestra la suma de pesos (debería ser 100%) con botón «Normalizar a 100%»; un criterio nuevo propone el porcentaje restante. Las correcciones ya aprobadas conservan su nota.
- **Gemini / error 400:** el 400 que llegaba a `api.js` se mostraba sin causa. Ahora se ve el mensaje de Google (estado y texto, sin claves) y se guarda en `ai_generation.error_code` (p. ej. `HTTP_400_INVALID_ARGUMENT`); `api.js` además muestra errores de validación por campo. Causas típicas de 400 de Google: clave inválida, región o facturación no habilitada.
- **Tiempos de carga:** compresión GZip de la API; el resumen se pide en paralelo con `/me/`; pintado inmediato desde caché de sesión (10 min, se limpia al cerrar sesión) mientras se actualiza; esqueleto de carga.
- **Registro de devoluciones:** `GET/POST corrections/{id}/deliveries/` deja constancia (canal, destinatario, fecha) en la auditoría, sin cambios de esquema; la pantalla de una devolución aprobada muestra «Envíos registrados». No hay envío automático ni confirmación de recepción.

Pendiente de despliegue (v1.0.9): la migración de timeout ya se aplicó en producción el 2026-11-07; queda configurar la clave del proveedor y la aprobación operativa correspondiente, y ejecutar `verify_ai --live` más pruebas E2E en el entorno real. Las pruebas de adaptadores usan HTTP simulado y no sustituyen una prueba con credenciales de producción.

## v1.0.4

- Corregido STATICFILES_DIRS (tuplas prefijo/directorio invertidas): rompía collectstatic y el servido de CSS/JS.
- Corregido ReferenceError (escapeHtml sin importar) al elegir evaluación en «Registrar entrega».
- Corregido 500 al eliminar una consigna (select_for_update con LEFT JOIN).
- Límites: user 900/min, IA 120/hora (configurables por THROTTLE_*); importar archivos ya no cuenta como IA. Antes se obtenía 429 tras ~10 acciones.
- JS/CSS con Cache-Control: no-cache (evita que queden scripts viejos en el navegador tras un deploy).
- Los bloques del curso se mantienen abiertos tras guardar.
- Botones «Volver» de entrega/devolución corregidos; nueva entrada «Rúbricas» en el menú.
- Plantilla CSV de estudiantes (antes 404); el CSV acepta «;» y muestra filas omitidas.
- Tests: perfil docente en el helper de Auth (de 43 a 11 fallas; restantes: tests desactualizados).
