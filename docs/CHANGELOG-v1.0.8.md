# MaestrIA v1.0.8

## Rendimiento

- El espacio docente ya no descarga siete listas al entrar ni las vuelve a pedir tras cada guardado: cada vista carga solo lo que usa (`frontend/js/modules/data/resources.js`).
- `modulepreload` de los 25 módulos del espacio docente (antes, cascada de 4 niveles con revalidación en cada uno).
- Logos reducidos de 2818 px a 800 px (de ~117 KB a ~38 KB cada uno) y eliminada una imagen de 1,8 MB sin referencias.

## Limpieza

- Eliminadas copias duplicadas y desactualizadas del frontend: `frontend/assets/css`, `frontend/assets/js`, las páginas HTML sueltas en la raíz de `frontend/`, `frontend/espacio-docente/` y una plantilla CSV con columnas que el importador no acepta.
- Eliminadas seis hojas de estilo sin uso (ya incluidas en `workspace.css`) y `site.css`.
- Corregida la ruta de la imagen de portada de «Nosotros» (apuntaba a `/assets/assets/images/…`).

## Correcciones

- `POST /api/contact/` respondía 500 ante un cuerpo JSON que no es un objeto; ahora responde 400.
- El guardián del último superadministrador lanza `check_violation` (23514) para que Django lo informe como `IntegrityError`.
- Errores de curso al crear/importar estudiantes con el mismo formato (lista) que el resto de la API.
- Doce pruebas desactualizadas tras los refactores actualizadas (límite de contacto compartido entre pruebas, ruta del mock de IA, FK compuesta, etc.). Suite: 92 pruebas en verde.
