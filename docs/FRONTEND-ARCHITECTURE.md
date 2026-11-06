# Arquitectura del frontend — MaestrIA

El frontend se mantiene como HTML5, CSS y JavaScript nativo con módulos ES. No requiere React, Next.js, bundler ni instalación de paquetes npm.

## Punto de entrada

`frontend/html/espacio-docente/index.html` carga `assets/js/workspace.js` como `type="module"`. El adaptador `modules/core/api.js` importa explícitamente `config.js` y el cliente HTTP/Auth clásico, por lo que la secuencia de inicialización no depende del orden de varios `<script defer>` en el HTML. Las páginas públicas mantienen los scripts clásicos hasta que se migren al mismo modelo.

## Capas

```text
frontend/js/
├── config.js                 # Resolución del origen de la API
├── api.js                    # HTTP, sesión Supabase y renovación JWT
├── auth.js / main.js         # Sitio público y autenticación
├── workspace.js              # Entry point del espacio docente
└── modules/
    ├── app.js                # Composición e inicialización
    ├── core/
    │   ├── api.js            # Adaptador al cliente HTTP
    │   ├── state.js          # Estado compartido de la aplicación
    │   ├── router.js         # Navegación y renderizado
    │   ├── ui.js             # Modales, toast, tema y navegación lateral
    │   └── utils.js          # Formateo, escape y helpers de vistas
    ├── data/
    │   ├── resources.js      # Listas bajo demanda: qué necesita cada vista y carga deduplicada
    │   └── repository.js     # Perfil, resumen, administración y refresco tras escrituras
    ├── events.js             # Delegación de eventos del espacio
    └── features/
        ├── dashboard.js
        ├── courses.js
        ├── students.js
        ├── assessments.js
        ├── rubrics.js
        ├── submissions.js
        ├── corrections.js
        ├── admin.js
        ├── profile.js
        ├── share.js
        ├── guide.js
        ├── forms.js            # Orquestación de envíos y reexports
        └── forms/
            ├── teacher.js     # Constructores de formularios docentes
            └── admin.js       # Constructores de formularios administrativos
```

## Contratos y reglas

- `assets/js/api.js` es la infraestructura HTTP/Auth: `fetch`, Supabase Auth, headers, timeout, cancelación, refresh y errores HTTP. `modules/core/api.js` expone esa infraestructura al espacio docente como una dependencia ES module única.
- `repository.js` obtiene y normaliza recursos del backend, con un máximo de cuatro lecturas iniciales concurrentes; no determina permisos ni inventa roles.
- `/api/me/` es obligatorio para iniciar el espacio. El rol y estado del perfil provienen exclusivamente del backend.
- `features/` genera vistas y formularios por dominio. No debe incorporar secretos ni decidir permisos de negocio.
- `events.js` traduce interacciones del DOM a acciones de dominio.
- Django es la autoridad para autenticación, autorización, validación y aislamiento de datos.
- El estado global se mantiene pequeño y explícito; no se incorpora una librería de estado para este MVP.

## Carga de datos y rendimiento

- **Inicio:** solo `/api/me/` y `/api/dashboard/overview/` (en paralelo). El resumen trae cursos y evaluaciones compactos y los contadores del panel; el panel se dibuja con eso.
- **Por vista:** `data/resources.js` declara qué listas necesita cada vista (`hard`: bloquea el dibujado con un esqueleto; `soft`: completa el panel sin bloquearlo). Cada lista se pide una sola vez por sesión y las solicitudes simultáneas se comparten.
- **Tras guardar:** `refreshCore()` actualiza el resumen y únicamente las listas que la sesión ya cargó, en lugar de las siete.
- **Módulos:** `espacio-docente/index.html` precarga con `modulepreload` todo el grafo de módulos (25 archivos, profundidad 4), de modo que el navegador los pide en paralelo y no en cascada. `scripts/check_static_frontend.py` falla si la lista y el grafo real difieren.
- **Una sola página:** el espacio docente mantiene una única página con navegación del lado del cliente. Separar secciones en HTML distintos obligaría a repetir el menú lateral y a volver a validar sesión y perfil en cada cambio, que es más lento que la navegación actual con datos bajo demanda.

## Decisiones de resiliencia y accesibilidad

- Las lecturas iniciales se ejecutan con concurrencia limitada a cuatro solicitudes; cada recurso conserva su estado de error individual.
- Un error de `/api/me/` detiene la inicialización. No se sintetiza un perfil de docente.
- Los errores HTTP conservan el código de estado en `ApiError`, permitiendo distinguir sesión vencida, falta de permisos y fallas de servidor.
- El botón de reintento vuelve a ejecutar la inicialización sin duplicar promesas concurrentes.
- Los modales atrapan el foco con Tab/Shift+Tab, restauran el foco al cerrarse y preservan el overflow anterior del documento.
- Los avisos de error usan `role=alert`; los avisos normales usan `role=status`.
- Los helpers de botones escapan sus etiquetas y atributos de acción. Los datos dinámicos deben seguir escapándose en el punto de interpolación HTML.

## Límites actuales

- El estado es mutable y compartido; mantener las mutaciones dentro de las operaciones de dominio.
- `events.js` sigue siendo un módulo relativamente grande. Separarlo por dominio es una evolución posible si aumenta la cantidad de acciones.
- `forms.js` conserva el despacho de envíos y operaciones; los constructores de formularios se separaron en módulos docentes y administrativos. Los formularios de cursos permanecen en `features/courses.js`, junto a su vista y reglas de presentación.
- La aplicación reconstruye partes de la vista con `innerHTML`; se debe continuar auditando cada interpolación dinámica y evitar insertar HTML de usuarios sin escape contextual.
- Los tokens de Supabase se guardan en `sessionStorage`. Esto evita persistencia entre sesiones de pestaña, pero no los protege frente a XSS. Para producción con datos académicos sensibles, se debe evaluar un BFF con cookies `HttpOnly`, `Secure` y `SameSite`.
