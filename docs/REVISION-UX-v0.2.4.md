# Revisión UX de MaestrIA v0.2.4

## Objetivo

Reducir la carga cognitiva en el espacio de corrección sin quitar capacidades docentes útiles. El rediseño prioriza la tarea actual y revela herramientas opcionales únicamente cuando se necesitan.

## Patrones observados en productos comparables

### CoGrader

La descripción pública de CoGrader presenta un flujo breve y reconocible: importar la entrega, aplicar criterios de una rúbrica, revisar la propuesta y aprobarla. La herramienta vincula comentarios a criterios y mantiene el control docente antes de publicar resultados.

Fuente: https://cograder.com/ai-grading-feedback/

### Gradescope

La documentación de Gradescope separa la revisión de las entregas, la rúbrica y la publicación de calificaciones. Explica que los estudiantes ven puntuaciones y devoluciones cuando se publican; la rúbrica permite relacionar la nota con criterios y comentarios.

Fuente: https://www.gradescope.com/help

### Brisk Teaching

Brisk describe opciones de feedback estructuradas —por ejemplo, feedback alineado a rúbrica y próximos pasos— y mantiene las devoluciones en borrador hasta que el docente las revisa/aprueba. La lección para MaestrIA es mostrar primero la propuesta y su estado, sin saturar la pantalla con opciones no necesarias en cada momento.

Fuentes: https://www.briskteaching.com/give-feedback y https://help.briskteaching.com/hc/en-us/articles/39310182411412-How-To-Give-Feedback

### MagicSchool AI

La descripción de la plataforma destaca herramientas categorizadas y contexto docente (materia, nivel y objetivo) como marco de preparación. Para MaestrIA se adopta la agrupación por tarea y el contexto visible, no el catálogo de muchas herramientas en la misma pantalla.

Fuente: https://www.avid.org/digital-tools/MagicSchool-AI

## Decisiones de diseño derivadas

1. **Navegación lateral corta.** Se reemplazaron cuatro grupos de navegación por seis destinos directos. Los nombres se acortaron a etiquetas familiares y orientadas a acción. En móvil, la lista pasa a una única fila desplazable para no aumentar innecesariamente la altura de la pantalla.
2. **Cabecera consistente.** Se separa orientación (breadcrumb, ayuda, perfil) de la acción principal de página. La cabecera pública no se repite dentro del espacio autenticado. El selector de evaluación está integrado en el encabezado de la página en vez de ocupar una tarjeta completa aparte.
3. **Tres tareas paralelas en desktop.** El contexto, la entrega y la cola quedan visibles en paneles distinguibles. El diseño se adapta a dos columnas en tamaños intermedios y una sola en móviles.
4. **Progresión y estados.** Se conserva el indicador de tres etapas; las etiquetas son más breves y se mantienen marcas de paso actual/completado. La lista deja un único filtro de estado para reducir competencia visual.
5. **Revelación progresiva.** Objetivos, opciones de consignas/tono, instrucciones de privacidad, opciones de material y explicación de criterios generales siguen disponibles, pero inicialmente no ocupan espacio si el docente no los necesita.
6. **Color con semántica.** Verde identifica contexto y acción primaria; coral diferencia la carga de respuesta; azul identifica seguimiento. El color se aplica a cabeceras, iconos, estados y barras, no a todos los contenedores.
7. **Legibilidad y accesibilidad.** Se mantienen etiquetas conectadas a controles, títulos semánticos, mensajes de estado, foco visible, navegación por teclado y layout adaptable.

## Alcance y límites

La comparación toma como base documentación y páginas públicas de producto; no es un análisis de telemetría, pruebas de usuarios ni inspección completa de sus aplicaciones autenticadas. No se importaron logos, assets ni componentes propietarios. Los patrones se adaptaron a funciones actuales de MaestrIA y no implican que MaestrIA tenga integración LMS o evaluación por lotes.
