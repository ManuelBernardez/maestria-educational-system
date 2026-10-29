# MaestrIA — revisión y rediseño UX/UI

**Fecha:** 28 de octubre de 2026  
**Alcance:** frontend docente y recorridos principales.  
**Referencia visual aportada:** `index (1).html` (prototipo de Asistente de Corrección Docente).

## 1. Criterios de diseño utilizados

La reorganización prioriza la tarea docente —organizar una materia, preparar una evaluación, corregir entregas y revisar/devolver resultados— sobre detalles técnicos de la implementación. Se conservaron la navegación lateral, el contexto de curso, las etiquetas de estado y el espacio de corrección dividido en entrega original y propuesta.

El prototipo adjunto aporta un lenguaje visual concreto: fondo neutral, superficies blancas, acento índigo, tipografía jerárquica, tarjetas compactas, navegación lateral estable, estados de foco visibles, diseño responsive y reducción de movimiento. La vista de corrección separada en dos paneles y las tarjetas de nota son patrones útiles y se mantienen.

La investigación complementaria respalda cuatro decisiones:

- **Mostrar primero lo esencial:** la revelación progresiva evita cargar la vista principal con opciones avanzadas, siempre que las acciones frecuentes permanezcan visibles. [Nielsen Norman Group — Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/).
- **Favorecer reconocimiento sobre recuerdo:** los nombres de estudiantes, cursos, evaluaciones, notas y estados se presentan junto al objeto al que pertenecen, en vez de exigir que el docente reconstruya el contexto. [Nielsen Norman Group — Recognition and Recall](https://www.nngroup.com/articles/recognition-and-recall/).
- **Accesibilidad verificable:** se refuerzan foco, navegación con teclado, mensajes de estado y tamaños de objetivo; WCAG 2.2 incluye criterios explícitos para foco no oculto, tamaño mínimo de objetivos y mensajes de estado. [W3C — WCAG 2.2](https://www.w3.org/TR/wcag/).
- **Errores recuperables:** los mensajes deberían decir qué falló y qué puede hacer la persona, no depender únicamente del color o de una alerta genérica. [GOV.UK Design System — Error message](https://design-system.service.gov.uk/components/error-message/) y [Error summary](https://design-system.service.gov.uk/components/error-summary/).

Estos criterios son una guía de diseño; no sustituyen pruebas de usabilidad con docentes reales.

## 2. Inventario y clasificación

### Correctos — conservar

| Componente/patrón | Motivo |
|---|---|
| Navegación lateral y contexto persistente | Mantiene accesibles las áreas principales sin obligar a volver al inicio en cada operación. |
| Curso/materia como entidad de organización | Es el contexto que conecta alumnos, evaluaciones, entregas y correcciones. |
| Corrección dividida entre respuesta original y propuesta | Facilita contrastar evidencia con la devolución sin reemplazar la decisión docente. |
| Edición y aprobación por parte del docente | La propuesta automática no se presenta como una decisión final sin revisión humana. |
| Estado explícito de las correcciones | Pendiente, aprobada o rechazada distingue el flujo de trabajo. |
| Formularios con etiquetas y confirmación de acciones | Reduce incertidumbre respecto de qué se modifica y cuándo se guarda. |
| Advertencias relevantes de privacidad y modo de práctica | Se mantienen cerca del flujo donde el docente prepara o evalúa respuestas. |

### Necesarios pero mejorables — reorganizados o simplificados

| Componente | Cambio aplicado |
|---|---|
| Inicio del espacio docente | Se priorizan acciones frecuentes y métricas útiles; los cursos son el índice principal y muestran actividad, estudiantes y pendientes. |
| Relación curso–alumnos–evaluaciones–correcciones | Se añade una vista de curso que consolida esos recursos con enlaces directos, y se incorporan filtros por curso en los listados globales. |
| Listado de evaluaciones | Se organiza por curso y permite buscar/filtrar sin perder el contexto. Al crear una evaluación desde un curso se preselecciona ese curso. |
| Listado de estudiantes | Se incorporan búsqueda y filtros por curso y estado. En la ficha global se identifican los cursos asociados, con enlaces directos. Se evita duplicar al mismo estudiante por tener varias matrículas. |
| Listado de entregas | Se hace visible el curso junto a la evaluación, se añade búsqueda/filtro contextual y se distingue una propuesta rechazada de una pendiente. |
| Listado de correcciones | Se agrupa por curso. Cada tarjeta arranca plegada, identifica al estudiante como título principal y deja visibles la evaluación, fecha, nota (o “Sin nota”) y estado. El detalle, la evidencia y las acciones secundarias aparecen al expandir. |
| Título de corrección individual | El espacio de corrección identifica al estudiante como encabezado principal y deja el curso/evaluación como contexto secundario. |
| Alta y edición de cursos/estudiantes | Se sustituyen interacciones basadas en `window.prompt` por formularios integrados, etiquetados y más fáciles de usar con teclado. Los campos opcionales o avanzados se agrupan en detalles progresivos. |
| Carga, error y estados vacíos | Se incorporan mensajes y opciones de reintento en las vistas que cargan datos; los filtros sin resultados se diferencian de una lista realmente vacía. |
| Tema oscuro | Se ajustan las superficies de las páginas públicas y del espacio de corrección para evitar texto claro sobre paneles claros. El patrón de fondo se hace más visible en ambos temas y el control de tema también queda disponible en la barra superior privada. |
| Guía de inicio rápido | Se mantiene como ayuda opcional, con cierre por Escape, foco inicial, ciclo de foco de teclado y devolución del foco al cerrar. |
| Responsive y foco visible | Se agregan ajustes en pantallas estrechas, estilos de foco y respeto a `prefers-reduced-motion`. |

### No necesarios en el recorrido principal — retirados o relegados

| Elemento | Decisión |
|---|---|
| Tarjeta “Proveedor de IA: Gemini” y etiqueta técnica repetida del proveedor | Retiradas del flujo principal. El docente necesita saber qué puede hacer y qué debe revisar, no navegar metadatos del proveedor. Se mantienen indicaciones generales donde sí afectan seguridad, disponibilidad o el modo de práctica. |
| Acciones de exportar/compartir repetidas en cada tarjeta cerrada | Se mueven al detalle expandido de la corrección aprobada, reduciendo ruido sin eliminar capacidad. |
| Utilidades de práctica/promoción dentro del espacio principal | Relegadas a un bloque plegable de herramientas secundarias; la ayuda de práctica sigue disponible. |
| Descripción larga y campos avanzados en el formulario de curso | Se pliegan y aparecen solo cuando hacen falta. |
| Sección de actividad reciente vacía | No se renderiza cuando no hay actividad útil que mostrar. |
| Métricas redundantes o de valor ambiguo en la portada | Se priorizan pendientes, materias activas, entregas recibidas y recuentos útiles por curso. |

No se quitaron la rúbrica, evidencia, justificación, comentarios, aprobación docente, mecanismos de exportación ni los controles de privacidad: forman parte del trabajo de corrección, aunque parte del detalle se muestre progresivamente.

## 3. Archivos principales modificados

- `frontend/src/app/styles/ux-refresh.css`: sistema de estilos del rediseño, tarjetas, filtros, contexto de curso, estados, adaptaciones responsive, foco, movimiento reducido y tema oscuro.
- `frontend/src/app/app/layout.tsx`: carga el nuevo sistema de estilos en el área autenticada.
- `frontend/src/app/app/page.tsx`: resumen docente y accesos por curso.
- `frontend/src/app/app/cursos/page.tsx` y `frontend/src/app/app/cursos/[id]/page.tsx`: lista de cursos y vista central de cada curso.
- `frontend/src/app/app/alumnos/page.tsx`: búsqueda, filtros y edición de estudiantes.
- `frontend/src/app/app/evaluaciones/page.tsx`, `frontend/src/app/app/evaluaciones/nueva/page.tsx` y `frontend/src/app/app/evaluaciones/[id]/page.tsx`: organización y contexto por curso.
- `frontend/src/app/app/entregas/page.tsx`: listado contextual de entregas y estados.
- `frontend/src/app/app/correcciones/page.tsx`: agrupación por curso, tarjetas compactas plegadas por defecto, nota visible, título por estudiante y acciones secundarias en el detalle.
- `frontend/src/app/app/espacio-correccion/page.tsx`: contexto de estudiante/curso/evaluación y menor protagonismo de detalles técnicos del proveedor.
- `frontend/src/components/AppSidebar.tsx`: nomenclatura más directa de navegación.
- `frontend/src/components/QuickStartTour.tsx`: uso por teclado y gestión del foco.

## 4. Cambios de comportamiento importantes

1. La vista de curso actúa como punto central para estudiantes, evaluaciones y correcciones asociadas.
2. Las vistas globales pueden filtrarse por curso, y enlaces internos conservan el ID del curso mediante query string o ruta.
3. Las tarjetas de corrección empiezan plegadas y la nota no queda oculta al expandir. Cuando no hay calificación, la interfaz muestra “Sin nota” en lugar de confundirlo con cero.
4. El nombre del estudiante es el encabezado principal de la corrección individual; evaluación y curso quedan como información contextual secundaria.
5. Las acciones menos frecuentes se muestran progresivamente, sin eliminar acceso a la información de detalle.
6. Se mantienen estados visibles de carga, error, éxito y ausencia de datos, además del soporte de foco/teclado en la ayuda inicial.

## 5. Persistencia y migraciones

**No se añadió una migración de base de datos.** El endpoint de matrículas expone ahora `student_external_code` como campo de solo lectura, obtenido de `Student.external_code`; no se cambió el esquema ni se añadió almacenamiento. La interfaz usa ese valor para mostrar nombre, correo y legajo sin avatares en la lista de estudiantes del curso.

## 6. Validación y limitaciones

- Se analizó la sintaxis de los 45 archivos TypeScript/TSX: **sin errores de análisis sintáctico** en la revisión estática ejecutada.
- El archivo CSS nuevo tiene llaves balanceadas.
- La revisión del código muestra que las tarjetas de corrección usan estado plegado por defecto y muestran nota/estado antes del detalle.
- **No se pudo ejecutar un build real de Next.js ni el chequeo de tipos/lint**, porque no están instaladas las dependencias locales y la resolución de paquetes desde npm no estuvo disponible en este entorno. Por ello, no se afirma que el proyecto compile ni que los tests end-to-end hayan pasado.
- El manifiesto del frontend y su lockfile mantienen una discrepancia preexistente: `package.json` declara `eslint-config-next` `^16.4.2`, mientras que el lockfile contiene una referencia a `^14.2.35`. Debe regenerarse y validarse el lockfile en un entorno con acceso al registro antes de `npm ci` y del despliegue.
- No se efectuó una prueba de usabilidad observada con docentes, una auditoría WCAG completa ni pruebas visuales en navegadores reales. Deben probarse teclado, lector de pantalla, móvil, tema oscuro y flujos de curso con cuentas de prueba antes de publicar.

### Ajustes de contraste y navegación — 28 de octubre de 2026

- Se elevó el tamaño y el contraste de los puntos del fondo, tanto en el sitio público como en el espacio docente.
- Se adaptaron al tema oscuro las tarjetas de responsabilidad docente, los paneles de carga/revisión y varios contenedores de respuesta que conservaban fondos claros fijos.
- Se ubicó el selector claro/oscuro entre Ayuda y el perfil en la barra privada.
- Se reemplazaron los símbolos del menú lateral por emojis relacionados con panel, trabajo, materias y estudiantes.
- Se retiró la navegación redundante por anclas en la cabecera de la materia. El acceso a Entregas se conserva como enlace independiente porque abre una vista con funciones propias.
- Se retiraron los avatares de la lista de matrículas y se muestran nombre, correo y legajo/código. La API expone el código como dato de solo lectura.
- La validación de sintaxis Python y el balance de llaves CSS pasaron. El chequeo completo de TypeScript/build no se pudo completar porque las dependencias de frontend no estaban disponibles; npm ci agotó el tiempo de ejecución en este entorno.

## 7. Pruebas manuales recomendadas

1. Desde Inicio → entrar a un curso → abrir un estudiante, evaluación y corrección. Confirmar que no se pierde el contexto de curso.
2. Abrir `/app/correcciones`: comprobar que todas las tarjetas comienzan plegadas, nota y estado son visibles y el título es el nombre del estudiante.
3. Expandir y plegar una tarjeta con teclado, verificar `aria-expanded` y que el detalle se oculta realmente.
4. Usar búsqueda, filtros por curso y estados sin resultados en alumnos, evaluaciones, entregas y correcciones; limpiar los filtros.
5. Crear/editar cursos y alumnos, incluyendo validaciones y cancelación de edición.
6. Abrir una corrección aprobada y una pendiente; comprobar que compartir solo se ofrece cuando corresponde y que “Sin nota” nunca se representa como cero.
7. Recorrer la guía inicial solo con teclado; verificar Escape, Tab, Shift+Tab y retorno de foco.
8. Verificar tema claro/oscuro, ancho móvil y movimiento reducido.
9. Ejecutar `npm ci`, `npm run lint`, `npm run typecheck` y `npm run build` con el lockfile corregido antes de desplegar.
