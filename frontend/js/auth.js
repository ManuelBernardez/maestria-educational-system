(() => {
  'use strict';
  const api = window.MAESTRIA_API;
  if (!api) return;
  const $ = (selector) => document.querySelector(selector);
  const loginTab = $('#tab-login'), registerTab = $('#tab-register');
  const loginForm = $('#panel-login'), registerForm = $('#panel-register'), recoverForm = $('#panel-recover');
  const tabBar = $('#auth-switch'), title = $('#auth-title'), description = $('#auth-description');
  const redirectTo = new URL('../espacio-docente/index.html', window.location.href).href;
  const confirmationRedirect = new URL('acceso.html', window.location.href).href;
  const recoveryRedirect = new URL('restablecer-clave.html', window.location.href).href;
  const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const clearMessages = () => document.querySelectorAll('.form-message').forEach(node => { node.textContent = ''; node.className = 'form-message'; });
  const showMessage = (id, text, success = false) => { const el = $(id); if (el) { el.textContent = text; el.className = `form-message${success ? ' success' : ''}`; } };
  const busy = (form, state) => { const button = form?.querySelector('[type="submit"]'); if (!button) return; button.disabled = state; button.dataset.originalText ||= button.textContent.trim(); button.textContent = state ? 'Procesando…' : button.dataset.originalText; };

  function switchTab(tab) {
    const isLogin = tab === 'login'; clearMessages();
    loginTab?.classList.toggle('is-active', isLogin); registerTab?.classList.toggle('is-active', !isLogin);
    loginTab?.setAttribute('aria-selected', String(isLogin)); registerTab?.setAttribute('aria-selected', String(!isLogin));
    if (loginForm) loginForm.hidden = !isLogin; if (registerForm) registerForm.hidden = isLogin;
    if (recoverForm) recoverForm.hidden = true; if (tabBar) tabBar.hidden = false;
    if (title) title.textContent = isLogin ? 'Qué bueno verte' : 'Una cuenta, tu espacio.';
    if (description) description.textContent = isLogin ? 'Ingresá para continuar con tu trabajo docente.' : 'Creá tu cuenta para organizar tu trabajo docente.';
    (isLogin ? $('#login-email') : $('#register-first-name'))?.focus();
  }
  function showRecovery() {
    clearMessages(); if (loginForm) loginForm.hidden = true; if (registerForm) registerForm.hidden = true;
    if (recoverForm) recoverForm.hidden = false; if (tabBar) tabBar.hidden = true;
    if (title) title.textContent = 'Recuperá tu acceso.';
    if (description) description.textContent = 'Te enviaremos un enlace para restablecer tu contraseña.';
    $('#recover-email').value = $('#login-email')?.value.trim() || ''; $('#recover-email')?.focus();
  }
  loginTab?.addEventListener('click', () => switchTab('login'));
  registerTab?.addEventListener('click', () => switchTab('register'));
  $('#forgot-password')?.addEventListener('click', showRecovery);
  $('#back-to-login')?.addEventListener('click', () => switchTab('login'));
  document.querySelectorAll('[data-toggle-password]').forEach(button => button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.togglePassword); if (!input) return;
    const visible = input.type === 'text'; input.type = visible ? 'password' : 'text';
    button.textContent = visible ? 'Mostrar' : 'Ocultar'; button.setAttribute('aria-label', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
  }));

  loginForm?.addEventListener('submit', async event => {
    event.preventDefault(); clearMessages();
    const email = $('#login-email').value.trim().toLowerCase(); const password = $('#login-password').value;
    if (!validEmail(email)) return showMessage('#login-message', 'Ingresá un correo electrónico válido.');
    if (password.length < 8) return showMessage('#login-message', 'La contraseña debe tener al menos 8 caracteres.');
    busy(loginForm, true);
    try {
      const payload = await api.authRequest('token?grant_type=password', 'POST', { email, password });
      api.setSession(payload); window.location.replace(redirectTo);
    } catch (error) { showMessage('#login-message', error.message || 'No se pudo iniciar sesión.'); }
    finally { busy(loginForm, false); }
  });

  registerForm?.addEventListener('submit', async event => {
    event.preventDefault(); clearMessages();
    const first = $('#register-first-name').value.trim(), last = $('#register-last-name').value.trim();
    const email = $('#register-email').value.trim().toLowerCase(), password = $('#register-password').value;
    const confirm = $('#register-confirm').value;
    if (!first || !last) return showMessage('#register-message', 'Completá tu nombre y apellido.');
    if (!validEmail(email)) return showMessage('#register-message', 'Ingresá un correo electrónico válido.');
    const passwordError = api.passwordPolicyError(password);
    if (passwordError) return showMessage('#register-message', passwordError);
    if (password !== confirm) return showMessage('#register-message', 'Las contraseñas no coinciden.');
    busy(registerForm, true);
    try {
      const payload = await api.authRequest(`signup?redirect_to=${encodeURIComponent(confirmationRedirect)}`, 'POST', { email, password, data: { full_name: `${first} ${last}`.trim() } });
      if (payload.access_token) { api.setSession(payload); window.location.replace(redirectTo); return; }
      showMessage('#register-message', 'Tu cuenta fue creada. Revisá tu correo para confirmar la dirección. Cuando la confirmes, ingresá desde la pestaña Ingresar.', true);
    } catch (error) { showMessage('#register-message', error.message || 'No se pudo crear la cuenta.'); }
    finally { busy(registerForm, false); }
  });

  recoverForm?.addEventListener('submit', async event => {
    event.preventDefault(); showMessage('#recover-message', '');
    const email = $('#recover-email').value.trim().toLowerCase();
    if (!validEmail(email)) return showMessage('#recover-message', 'Ingresá un correo electrónico válido.');
    busy(recoverForm, true);
    try {
      await api.authRequest(`recover?redirect_to=${encodeURIComponent(recoveryRedirect)}`, 'POST', { email });
      showMessage('#recover-message', 'Si existe una cuenta para ese correo, recibirás un enlace para restablecer el acceso.', true);
    } catch (error) { showMessage('#recover-message', error.message || 'No se pudo solicitar la recuperación.'); }
    finally { busy(recoverForm, false); }
  });

  if (window.location.hash.includes('type=recovery')) {
    window.location.replace(new URL('restablecer-clave.html' + window.location.hash, window.location.href).href);
  } else if (window.location.hash.includes('access_token=')) {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = fragment.get('access_token');
    if (token) {
      try {
        api.setSession({ access_token: token, refresh_token: fragment.get('refresh_token') || '', expires_in: Number(fragment.get('expires_in') || 3600) });
        history.replaceState(null, '', window.location.pathname);
        window.location.replace(redirectTo);
      } catch { showMessage('#login-message', 'No se pudo validar la confirmación. Ingresá nuevamente o solicitá otro enlace.'); }
    }
  } else if (api.getSession()) {
    api.validSession().then(session => { if (session && window.location.pathname.endsWith('/acceso.html')) window.location.replace(redirectTo); }).catch(() => {});
  }
  if (window.location.hash === '#recuperar') showRecovery();
})();
