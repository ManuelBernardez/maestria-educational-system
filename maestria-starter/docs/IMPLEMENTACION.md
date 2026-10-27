# Orden de implementación recomendado

1. Verificar la instalación local del frontend y backend.
2. Crear proyecto Supabase de desarrollo y configurar Auth.
3. Aplicar la migración SQL en un entorno limpio; revisar las políticas RLS con las credenciales exactas del backend.
4. Implementar el repositorio de datos y CRUD de evaluaciones con aislamiento por usuario.
5. Implementar preguntas y rúbricas; definir un contrato estable compartido entre frontend y backend.
6. Implementar carga de respuestas y persistencia de propuestas/historial.
7. Configurar un proveedor de IA y evaluar respuestas de referencia.
8. Implementar edición y aprobación docente, con separación entre propuesta y resultado final.
9. Añadir exportación; luego correo/WhatsApp mediante adaptadores.
10. Automatizar pruebas de aislamiento, flujo crítico, accesibilidad y despliegue.

No habilitar datos reales hasta superar una revisión de seguridad y privacidad y acordar el procedimiento de borrado y recuperación.
