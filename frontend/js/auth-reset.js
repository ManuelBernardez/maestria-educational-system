(() => {
  'use strict';
  const api = window.MAESTRIA_API;
  const form = document.getElementById('reset-form');
  const message = document.getElementById('reset-message');
  if (!api || !form) return;
  const show = (text, success = false) => { message.textContent = text; message.className = `form-message${success ? ' success' : ''}`; };
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const accessToken = fragment.get('access_token');
  const refreshToken = fragment.get('refresh_token') || '';
  const errorDescription = fragment.get('error_description') || fragment.get('error');
  if (errorDescription) show('El enlace no es válido o venció. Solicitá uno nuevo desde el acceso.');
  else if (!accessToken || fragment.get('type') !== 'recovery') show('No encontramos un enlace de recuperación válido. Solicitá uno nuevo desde el acceso.');
  else {
    try { api.setSession({ access_token: accessToken, refresh_token: refreshToken, expires_in: Number(fragment.get('expires_in') || 3600) }); history.replaceState(null, '', window.location.pathname); }
    catch { show('No se pudo validar el enlace. Solicitá uno nuevo desde el acceso.'); }
  }
  document.querySelectorAll('[data-toggle-password]').forEach(button => button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.togglePassword); if (!input) return;
    const visible = input.type === 'text'; input.type = visible ? 'password' : 'text'; button.textContent = visible ? 'Mostrar' : 'Ocultar';
  }));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const tokenSession = api.getSession();
    const password = document.getElementById('new-password').value;
    const confirmation = document.getElementById('confirm-password').value;
    if (!tokenSession?.access_token || fragment.get('type') !== 'recovery') return show('El enlace de recuperación no está disponible o venció. Solicitá uno nuevo.');
    const passwordError = api.passwordPolicyError(password);
    if (passwordError) return show(passwordError);
    if (password !== confirmation) return show('Las contraseñas no coinciden.');
    const button = form.querySelector('[type="submit"]'); button.disabled = true;
    try {
      await api.authUserRequest('PUT', { password }, tokenSession.access_token);
      api.clearSession(); show('La contraseña se actualizó. Ya podés ingresar con tu nueva clave.', true);
      form.reset(); window.setTimeout(() => { window.location.replace('acceso.html'); }, 1800);
    } catch (error) { show(error.message || 'No se pudo actualizar la contraseña. Solicitá un nuevo enlace si venció.'); }
    finally { button.disabled = false; }
  });
})();
