# Proxies, IP del cliente y límites de frecuencia

Los límites de frecuencia de DRF y el registro de IP en `audit_event` identifican al
cliente con `apps.core.network.client_ip`, que aplica la regla de DRF:

- `DRF_NUM_PROXIES=0`: se usa `REMOTE_ADDR` (local, sin proxy).
- `DRF_NUM_PROXIES=N`: se usa la N-ésima IP **desde el final** de `X-Forwarded-For`.

Cada proxy agrega su entrada al final del header, pero no borra lo que mandó el
cliente. Por eso nunca se usa la primera IP: la puede escribir cualquiera.

## Valor en Render

Render no documenta oficialmente cuántos proxies agrega. Según mediciones publicadas por
usuarios, la cadena es cliente → Cloudflare → proxy de Render → Gunicorn, y el header llega así:

```
X-Forwarded-For: <lo que mande el cliente>, <IP del cliente según Cloudflare>, <IP de Cloudflare>
REMOTE_ADDR:     <IP privada del proxy de Render>
```

`render.yaml` usa `DRF_NUM_PROXIES=1` mientras tanto. Toma la entrada que agrega el
proxy de Render, que el cliente no puede falsificar. La contra es que, si Cloudflare está
adelante, esa IP es la del nodo de Cloudflare y la comparten varios clientes. Si se
confirma la cadena de arriba, el valor correcto es `2`.

No usar `0` en Render: todos los pedidos tendrían la `REMOTE_ADDR` interna y compartirían un
único cupo (por ejemplo, 5 mensajes de contacto por hora para todo el sitio).

## Cómo medirlo

1. En Render → Environment, poner `LOG_PROXY_HEADERS=True` y guardar. El servicio se redespliega.
2. Abrir el sitio desde dos redes distintas (por ejemplo, wifi y datos del teléfono) y navegar un poco.
3. En Logs, buscar las líneas `proxy_headers`. No incluyen IPs, solo la forma del header:
   ```
   proxy_headers {'remote_addr': 'privada', 'xff_entradas': 2, 'xff_tipos': ['publica', 'publica'],
                  'true_client_ip_en_xff': '-2', 'cf_connecting_ip_en_xff': '-2'}
   ```
   Si `true_client_ip_en_xff` o `cf_connecting_ip_en_xff` valen `-2` de forma estable, usar
   `DRF_NUM_PROXIES=2`. Si valen `-1`, usar `1`.
4. Ajustar `DRF_NUM_PROXIES` (en `render.yaml` y en Environment) y volver a poner
   `LOG_PROXY_HEADERS=False`.

Si alguien puede llegar al servicio sin pasar por Cloudflare (directo a Render), el valor `2`
deja de ser seguro. En ese caso conviene quedarse en `1`.
