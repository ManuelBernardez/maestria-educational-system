/* Aplica el tema guardado antes de pintar los estilos (evita el destello).
 * El tema por defecto es el claro; el oscuro sólo se usa si la persona lo eligió. */
(() => {
  let theme = 'light';
  try {
    if (sessionStorage.getItem('maestria-theme') === 'dark') theme = 'dark';
  } catch { /* almacenamiento bloqueado: se queda el claro */ }
  document.documentElement.dataset.theme = theme;
})();
