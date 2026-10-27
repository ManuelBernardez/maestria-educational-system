# MaestrIA — Revisión de navegación y experiencia de usuario

**Fecha:** 22 de octubre de 2026
**Base:** `MaestrIA-proyecto-completo-v1.0`
**Iteración:** v1.1

## Cambios

- Se agregó una navegación global única desde el layout raíz, con enlace explícito a Inicio, enlaces de navegación del producto y acceso al espacio docente. La barra es sticky y también aparece en 404, loading y error boundaries.
- Se unificó el wordmark visible para utilizar `MaestrIA` con M mayúscula.
- La página de inicio utiliza `MaestrIA` como H1 y un H2 separado para el eslogan, con tipografía más contenida y alineación centrada en la columna del hero.
- La página de funciones se transformó en un explorador interactivo con filtros por etapa, tarjetas más breves, beneficios concretos y detalles progresivos.
- La demostración distingue explícitamente la consigna del examen, la respuesta entregada, los criterios/puntajes y la devolución editable; se redujo la cantidad de énfasis cromático y se aclaró que se trata de un ejemplo ficticio.
- La página Sobre nosotros se reestructuró para evitar el bloque verde de ancho de viewport que desbordaba su contenedor, con columnas flexibles y lectura responsive.
- La página `/app/evaluaciones/` ahora muestra un listado conectado a la API, estados de carga/error/vacío, reintento y acceso al espacio de trabajo.
- Se definió el estado `scaleType` usado por el formulario de rúbricas, corrigiendo `ReferenceError: scaleType is not defined`.
- Los estados de error ofrecen explícitamente regresar al espacio docente o al inicio. La navegación no ejecuta `signOut`; el login redirige al espacio docente cuando detecta una sesión Supabase existente.
- Se alineó `frontend/package.json` con Next.js 16.4.2, versión mencionada en el entorno del usuario.

## Comprobaciones realizadas

- Análisis sintáctico de 37 archivos TS/TSX mediante el parser TypeScript disponible: sin diagnósticos de sintaxis.
- Auditoría estática de rutas para enlaces locales: no se encontraron objetivos estáticos rotos.
- Comprobación de que el estado `scaleType` está declarado y la página de inicio contiene `<h1>MaestrIA</h1>`.
- Revisión de los nombres visibles de marca en TSX; no se encontraron marcas con M minúscula.

## Comprobaciones no realizadas

No se completó `npm install`, `npm run typecheck`, `npm run lint` ni `npm run build`: la descarga de dependencias agotó el tiempo límite y el entorno no tenía `node_modules`. Por tanto, el parser confirma sintaxis pero no reemplaza el chequeo de tipos, el lint ni el build de Next.js. Deben ejecutarse en el entorno local tras instalar dependencias.

## Pasos de validación local

```powershell
cd frontend
npm install
npm run check
npm run build
npm run dev
```

Probar manualmente: Inicio, navegación desde móvil, filtros de Funciones, controles de la demostración, Sobre nosotros sin overflow horizontal, `/no-existe` (404), error boundary, sesión ya iniciada al navegar a `/login`, lista de evaluaciones y creación/edición de una rúbrica en una evaluación real.
