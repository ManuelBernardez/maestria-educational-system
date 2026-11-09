"""Servido de estáticos con WhiteNoise también en desarrollo.

`runserver` sirve /assets/ con su propio handler, que no envía Cache-Control: el
navegador cachea los módulos ES por heurística y, tras cada cambio, mezcla módulos
viejos y nuevos (la interfaz queda a medio actualizar). Con `whitenoise.runserver_nostatic`
los sirve WhiteNoise, que aplica el mismo `no-cache` que producción.

En desarrollo (DEBUG) WhiteNoise busca primero en el código fuente con los finders de
Django. En Windows esa búsqueda fallaba: los directorios con prefijo de
STATICFILES_DIRS (`css/`, `js/`) sólo coinciden si la ruta usa el separador del sistema
(`js\\modules\\…`) y WhiteNoise pasa la URL con `/`. Al fallar, servía la copia
recolectada en STATIC_ROOT, que puede estar desactualizada.
"""
from urllib.request import url2pathname

from django.contrib.staticfiles import finders
from whitenoise.base import WhiteNoise
from whitenoise.middleware import WhiteNoiseMiddleware


class MaestriaWhiteNoiseMiddleware(WhiteNoiseMiddleware):
    def candidate_paths_for_url(self, url):
        if self.use_finders and url.startswith(self.static_prefix):
            # url2pathname convierte `/` al separador del sistema (no-op fuera de Windows).
            path = finders.find(url2pathname(url[len(self.static_prefix):]))
            if path:
                yield path
        # Sin finders (producción) o si no hubo coincidencia: STATIC_ROOT, como siempre.
        yield from WhiteNoise.candidate_paths_for_url(self, url)
