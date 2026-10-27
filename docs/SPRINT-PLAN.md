# Plan de integración — tres semanas

## Semana 1 — Base integrada
- [ ] Acordar el contrato de datos y el alcance de cada endpoint.
- [ ] Crear el proyecto Supabase y configurar Auth + PostgreSQL.
- [ ] Levantar frontend y backend localmente desde README.
- [ ] Verificar login, alta de evaluación y persistencia.
- [ ] Hacer pruebas de aislamiento con dos cuentas.
- [ ] Elegir proveedor IA con un benchmark pequeño; dejar `mock` solo para demo visual.

## Semana 2 — Flujo educativo
- [ ] Completar editor de preguntas y rúbrica.
- [ ] Cargar entregas, asociarlas a alumnos y generar corrección.
- [ ] Revisar/edit feedback y aprobar la propuesta.
- [ ] Validar evidencia y puntajes contra casos de referencia.
- [ ] Probar exportación y CSV.

## Semana 3 — Calidad y defensa
- [ ] Probar correo con cuenta sandbox; WhatsApp solo con cuenta oficial configurada.
- [ ] Añadir pruebas de API y regresión.
- [ ] Revisar responsive, teclado, contraste y errores.
- [ ] Desplegar frontend y API, configurar dominio, secretos y CORS.
- [ ] Preparar datos ficticios, demo repetible y resultados de benchmark.
- [ ] Documentar límites, riesgos y próximos pasos para piloto real.

## Gate antes de docentes reales
No usar datos reales hasta completar las pruebas de aislamiento, configuración HTTPS, política de privacidad/retención, límites de IA, backups/restauración y revisión de proveedor externo.
