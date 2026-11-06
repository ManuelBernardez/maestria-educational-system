# Auditoría de estabilización — MaestrIA (2026-11-06)

> Informe consolidado del estado del proyecto tras varios días de parches. Objetivo: identificar inconsistencias, errores, antipatrones, redundancias, sobreingeniería, problemas de lógica de negocio, asincronía, concurrencia, riesgos futuros (desarrollo, despliegue, uso), brechas de seguridad y problemas de eficiencia; y registrar las correcciones aplicadas.
>
> Alcance: `backend/` (Django + DRF + Supabase/PostgreSQL), `frontend/` (vanilla JS), `scripts/`, configuración de despliegue/CI y documentación.

## 1. Resumen ejecutivo

| Severidad | Hallazgos | Corregidos en esta sesión |
|---|---|---|
| Crítico | 1 | 1 |
| Alto | (pendiente de consolidación) | — |
| Medio | (pendiente) | — |
| Bajo | (pendiente) | — |

**Estado del bloqueador principal:** resuelto y validado contra Gemini real (corrección 201, entrega pasa a `review`, puntaje 10/10 con evidencia).

## 2. Hallazgos críticos

### C-1. El lease de corrección nunca se confirmaba ni se liberaba (trigger de Supabase vs `auto_now`)

**Síntoma reportado:** `POST /api/submissions/{id}/generate-correction/` → `400 {"submission": "El procesamiento fue reemplazado o venció..."}`; las entregas quedaban en `processing` para siempre y bloqueaban la edición del contexto docente.

**Causa raíz:** el esquema real de Supabase define, en **17 tablas**, triggers `BEFORE UPDATE` (`<tabla>_touch_updated_at`) que ejecutan `NEW.updated_at = clock_timestamp()`. El flujo de corrección usaba el valor del *instance* de Django (asignado por `auto_now` en `save()`) como identidad del lease:

```python
locked_submission.save(update_fields=["status", "updated_at"])
reservation_timestamp = locked_submission.updated_at   # valor Python, NO el persistido
...
if locked_submission.updated_at != reservation_timestamp:   # siempre True tras el trigger
    raise ValidationError("El procesamiento fue reemplazado o venció...")
```

Efectos encadenados:
1. La confirmación posterior a la llamada de IA fallaba **siempre** → 400 genérico (el usuario veía «no se pudo generar»).
2. `release_reservation()` comparaba con la misma identidad → **nunca liberaba** → filas atascadas en `processing`.
3. Los leases atascados (con la ventana previa de 15 min) bloqueaban PATCH de contexto, importar material y consignas → los 400 reportados durante varios días.
4. El fallo era **determinista**, no una carrera: por eso "reintentar" nunca funcionaba.

**Corrección aplicada:**
- `api_views/submissions.py`: tras el `save()` del lease se hace `refresh_from_db(fields=["updated_at"])` y se usa **el valor persistido** (post-trigger) como `reservation_timestamp`.
- Regresión cubierta: nuevo test `test_generate_correction_success_releases_lease_and_reaches_review` (verificado que **falla sin el fix** y pasa con él).
- **Deriva de entorno de pruebas corregida:** `backend/database/test_schema.sql` no incluía los triggers `touch_updated_at`; ahora los replica (función `maestria_touch_updated_at` + 17 triggers). Sin esto, ningún test podía detectar esta clase de bug.

**Validación en vivo:** `POST /api/submissions/6/generate-correction/` → `201`, proveedor `gemini`, corrección `pending_review`, entrega `review`.

**Recomendación de fondo:** dejar de usar `updated_at` como token de identidad; lo robusto es una columna de lease (`processing_token uuid` + `processing_expires_at`) o una tabla de reservas. Documentado como deuda técnica prioritaria.

## 3. Hallazgos altos / medios / bajos

_(En consolidación a partir de las auditorías de backend, frontend y despliegue.)_

## 4. Correcciones aplicadas (registro)

| # | Archivo | Cambio | Verificación |
|---|---|---|---|
| 1 | `backend/apps/core/api_views/submissions.py` | `refresh_from_db` del lease antes de fijar `reservation_timestamp` | test de regresión + smoke real Gemini 201 |
| 2 | `backend/database/test_schema.sql` | Triggers `touch_updated_at` replicados del esquema real | 29/29 tests workspace |
| 3 | `backend/apps/core/test_workspace.py` | Test de regresión del flujo completo de corrección | falla sin fix / pasa con fix |
| 4 | `backend/apps/core/models.py` + `common.py` + `serializers.py` + `submissions.py` | Constante única `PROCESSING_LEASE_MINUTES = 5` (antes 15 duplicado en 3 sitios) | `compileall` + tests |
| 5 | `backend/apps/core/api_views/catalog.py` | Eliminados los 5 guards que bloqueaban al docente editar el examen durante una corrección (consistencia cubierta por chequeos `updated_at` del endpoint de corrección) | 65/65 tests |
| 6 | `frontend/js/modules/events.js` | El submit del modal de IA se resolvía por prefijo `workspace-` antes que por id exacto → formulario secuestrado sin request | static check + verificación funcional |

## 5. Riesgos de despliegue y operación

_(En consolidación.)_

## 6. Deuda técnica y próximos pasos recomendados

_(En consolidación.)_
