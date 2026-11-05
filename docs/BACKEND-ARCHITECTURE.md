# Arquitectura del backend — MaestrIA

## Estilo arquitectónico

MaestrIA conserva un **monolito modular** con Django REST Framework. La separación busca reducir acoplamiento y tamaño de los puntos de entrada sin sumar capas vacías, repositorios duplicados ni dependencias innecesarias.

```text
backend/
├── config/
│   ├── settings.py             # Configuración por entorno y seguridad
│   └── urls.py                 # Enrutamiento HTTP y frontend same-origin
└── apps/core/
    ├── authentication.py      # Validación Supabase JWT y principal de request
    ├── permissions.py         # Autorización global, docente e institucional
    ├── models.py              # Mapeo ORM del esquema existente (managed=False)
    ├── serializers.py         # Contratos de entrada/salida y validaciones
    ├── admin_api.py           # Administración global/institucional
    ├── ai.py                  # Adaptadores y validación de respuestas IA
    ├── delivery.py            # Notificaciones de entrega
    ├── api_views/
    │   ├── common.py          # Políticas, helpers y consultas compartidas
    │   ├── dashboard.py       # Dashboard, workspace, perfil, contacto y health
    │   ├── catalog.py         # Cursos, matrículas, estudiantes, evaluaciones y rúbricas
    │   └── submissions.py    # Archivos, entregas, respuestas y correcciones
    └── views.py               # Fachada de compatibilidad para las rutas existentes
```

## Límites y dirección de dependencias

- **Presentación HTTP:** `urls.py`, viewsets y funciones en `api_views/`. Convierten requests en operaciones, aplican permisos y producen respuestas DRF.
- **Aplicación / reglas de flujo:** los viewsets coordinan validación, transacciones y servicios externos. Los procesos críticos de entrega/corrección mantienen snapshots, reserva con lease y bloqueo de filas.
- **Dominio y contratos:** `models.py` representa entidades persistidas; `serializers.py` valida y define contratos HTTP; `ai.py` contiene las reglas de validación de propuestas y los adaptadores de proveedores.
- **Persistencia:** PostgreSQL/Supabase es la fuente de verdad. Django ORM es el adaptador de acceso; los modelos de negocio permanecen `managed = False`.
- **Identidad:** Supabase Auth verifica credenciales; el backend obtiene rol y estado desde `user_profile`. Los roles enviados por el navegador nunca son fuente de autorización.

`views.py` mantiene los símbolos que consumen las rutas y otros puntos de integración. El código nuevo debe ir al módulo de dominio que corresponda y no volver a concentrarse en esa fachada.

## Persistencia y esquema

El esquema `public.*` existente no se modifica desde esta refactorización. No se agregaron migraciones Django, tablas, columnas, índices ni triggers. `db/maestria_schema_v2.sql` y el SQL de test mantienen su función de contrato; `backend/database/test_schema.sql` sólo se carga en la base efímera de pruebas.

No introducir un repositorio que duplique el ORM sin una necesidad concreta. Para este MVP, los querysets explícitos son el adaptador de persistencia. Mantener:

1. `owner_id` derivado de la identidad JWT validada, nunca del body/query del navegador.
2. Filtros por propietario también en relaciones anidadas y acciones personalizadas.
3. `transaction.atomic()` y un orden de bloqueos consistente para mutaciones que compiten.
4. `select_related`, `prefetch_related`, agregaciones/subqueries y serializers de resumen para evitar N+1 y payloads innecesarios.
5. Cambios físicos de base sólo mediante SQL revisado y una migración operativa explícita.

## Autenticación y ciclo de vida del request

1. Supabase emite el JWT.
2. `SupabaseJWTAuthentication` valida firma, algoritmo permitido, issuer, audience, expiración y subject.
3. Se consulta `user_profile` una vez. Si falta o está inactivo, el request falla cerrado.
4. Rol y estado verificados se adjuntan al principal sólo durante ese request; `permissions.py` los reutiliza sin otra consulta.
5. Los endpoints de dominio filtran el propietario autenticado y validan pertenencia antes de mutar relaciones.
6. El middleware agrega request ID, `Server-Timing`, política de no caché para API y encabezados de permisos.

El trigger de `auth.users` debe estar instalado y operativo: crea el perfil docente inicial. La herramienta `verify_public_schema` comprueba el contrato en modo de sólo lectura.

## Concurrencia, latencia y límites

- Los proveedores HTTP usan timeouts explícitos.
- Una solicitud de corrección procesa hasta diez respuestas y limita la concurrencia de proveedor a tres dentro de esa solicitud.
- La entrega queda reservada antes del trabajo externo; se revalidan timestamps al persistir, evitando guardar resultados sobre entradas modificadas concurrentemente.
- La reserva tiene una lease de recuperación. Esto reduce duplicaciones, pero no sustituye una cola de trabajos persistente.
- DRF throttling con caché local no comparte contadores entre workers. Antes de escalar horizontalmente debe configurarse Redis o rate limiting en el edge.

## Lo que esta arquitectura no afirma

No es una implementación estricta de Clean Architecture/Hexagonal: la capa HTTP todavía coordina parte de la lógica de aplicación y consulta el ORM directamente. Se separaron los módulos y se fijaron límites para facilitar una extracción futura de casos de uso, pero no se introdujo abstracción de repositorio o bus de comandos artificial. Antes de hacerlo conviene tener pruebas de integración y medir qué reglas realmente requieren independencia del framework.
