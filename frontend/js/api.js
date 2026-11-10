(() => {
  'use strict';
  const SESSION_KEY = 'maestria.auth.session.v1';
  const config = window.MAESTRIA_CONFIG || {};
  const API_BASE = String(config.apiBaseUrl || '').replace(/\/+$/, '');
  let clientConfigPromise = null;
  let refreshPromise = null;

  const safePath = (path) => {
    const value = String(path || '').trim();
    if (!value || value.startsWith('//') || /^[a-z][a-z\d+.-]*:\/\//i.test(value) || value.includes('\\') || value.split('/').includes('..')) {
      throw new Error('La ruta solicitada no es válida.');
    }
    return `${API_BASE}/${value.replace(/^\/+/, '')}`;
  };

  const networkError = (error, destino) => {
    if (error instanceof TypeError) return new Error(`No se pudo conectar con ${destino}. Revisá que esté en línea y que la URL sea correcta.`);
    return error;
  };

  async function fetchWithTimeout(url, options, timeoutMs = 20000, destino = 'Supabase') {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`La solicitud a ${destino} superó el tiempo de espera.`);
      }
      throw networkError(error, destino);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && parsed.access_token ? parsed : null;
    } catch { return null; }
  }
  function setSession(session) {
    if (!session || !session.access_token) throw new Error('Supabase no devolvió una sesión válida.');
    const value = {
      access_token: session.access_token,
      refresh_token: session.refresh_token || '',
      token_type: session.token_type || 'bearer',
      expires_at: session.expires_at || (session.expires_in ? Math.floor(Date.now() / 1000) + Number(session.expires_in) : 0),
      user: session.user || null
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    return value;
  }
  function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem('maestria.overview.v1'); } catch {} }

  async function loadClientConfig() {
    if (!clientConfigPromise) {
      clientConfigPromise = fetch(safePath('client-config/'), { headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'omit' })
        .then(async response => {
          if (!response.ok) throw new Error('No se pudo cargar la configuración pública de autenticación.');
          const payload = await response.json();
          if (!payload.supabase_url || !payload.supabase_anon_key) {
            throw new Error('El backend no tiene configurada la URL pública y la clave anon de Supabase.');
          }
          return Object.freeze({
            supabaseUrl: String(payload.supabase_url).replace(/\/+$/, ''),
            supabaseAnonKey: String(payload.supabase_anon_key)
          });
        }).catch(error => { clientConfigPromise = null; throw networkError(error, `el backend de MaestrIA (${API_BASE})`); });
    }
    return clientConfigPromise;
  }

  async function refreshSession() {
    if (refreshPromise) return refreshPromise;
    const current = getSession();
    if (!current?.refresh_token) { clearSession(); return null; }
    refreshPromise = (async () => {
      const auth = await loadClientConfig();
      const response = await fetchWithTimeout(`${auth.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST', headers: { apikey: auth.supabaseAnonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: current.refresh_token }), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
      }, 15000, `Supabase (${auth.supabaseUrl})`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.access_token) { clearSession(); return null; }
      return setSession(payload);
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  async function validSession() {
    const current = getSession();
    if (!current) return null;
    const remaining = Number(current.expires_at || 0) - Math.floor(Date.now() / 1000);
    if (remaining < 60) return refreshSession();
    return current;
  }

  const MESSAGE_KEYS = ['detail', 'error_description', 'msg', 'message', 'error'];
  // Claves que el backend usa con frases completas en español: el nombre técnico
  // del campo («submission: …») no le aporta nada al docente.
  const SENTENCE_KEYS = ['submission', 'correction', 'final_result', 'final_score', 'change_reason', 'file', 'avatar', 'answers', 'students', 'criteria'];
  const UNLABELED_KEYS = new Set([...MESSAGE_KEYS, ...SENTENCE_KEYS, 'non_field_errors']);

  /**
   * Aplana cualquier forma de error de DRF/Supabase a frases legibles:
   * `["texto"]` (ValidationError con un mensaje suelto), `{campo: ["texto"]}`,
   * listas de objetos de serializers anidados y `non_field_errors` sin prefijo.
   */
  function flattenErrors(value, key = '') {
    if (value === null || value === undefined) return [];
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      if (!text) return [];
      return [key && !UNLABELED_KEYS.has(key) ? `${key}: ${text}` : text];
    }
    if (Array.isArray(value)) return value.flatMap(item => flattenErrors(item, key));
    if (typeof value === 'object') return Object.entries(value).flatMap(([child, item]) => flattenErrors(item, /^\d+$/.test(child) ? key : child));
    return [];
  }

  function errorMessage(payload, statusCode) {
    for (const key of MESSAGE_KEYS) {
      const text = flattenErrors(payload?.[key]).join('; ');
      if (text) return text.slice(0, 1200);
    }
    const text = [...new Set(flattenErrors(payload))].join('; ');
    if (text) return text.slice(0, 1200);
    if (statusCode >= 500) return `El servidor no pudo completar la operación (HTTP ${statusCode}). Intentá de nuevo en unos minutos.`;
    return `No se pudo completar la operación (HTTP ${statusCode}).`;
  }

  class ApiError extends Error {
    constructor(message, status, payload = null) {
      super(message);
      this.name = 'ApiError';
      this.status = Number(status) || 0;
      this.payload = payload;
    }
  }

  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const url = safePath(path);
    const controller = new AbortController();
    const timeoutMs = Math.max(1000, Math.min(Number(options.timeoutMs || (method === 'GET' ? 30000 : 90000)), 180000));
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    const externalSignal = options.signal;
    const abortFromCaller = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abortFromCaller();
    else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    let body = options.body;
    if (body !== undefined && body !== null && !(body instanceof FormData) && typeof body !== 'string') {
      headers.set('Content-Type', 'application/json'); body = JSON.stringify(body);
    } else if (typeof body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const run = async (token, retry = false) => {
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const response = await fetch(url, { method, headers, body, signal: controller.signal, cache: 'no-store', credentials: 'omit' });
      if (response.status === 401) {
        if (!retry) {
          const current = getSession();
          if (current?.refresh_token) {
            const refreshed = await refreshSession();
            if (refreshed?.access_token) return run(refreshed.access_token, true);
          }
        }
        if (token && !options.allowAnonymous) {
          clearSession();
          window.dispatchEvent(new CustomEvent('maestria:session-expired'));
        }
      }
      if (response.status === 204) return null;
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok) {
        let payload = {};
        if (contentType.includes('application/json')) payload = await response.json().catch(() => ({}));
        else {
          const text = await response.text().catch(() => '');
          if (text) payload = { detail: text.slice(0, 1200) };
        }
        throw new ApiError(errorMessage(payload, response.status), response.status, payload);
      }
      if (options.rawResponse) return response;
      if (contentType.includes('application/json')) return response.json();
      return response.text();
    };
    try {
      if (!API_BASE) throw new Error('No está configurada la URL de la API. Revisá js/config.js.');
      const storedSession = getSession();
      const session = await validSession();
      const token = session?.access_token || null;
      if (storedSession && !session && !options.allowAnonymous) {
        window.dispatchEvent(new CustomEvent('maestria:session-expired'));
        throw new ApiError('La sesión expiró. Volvé a iniciar sesión.', 401);
      }
      return await run(token);
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('La solicitud excedió el tiempo de espera o fue cancelada.');
      if (error instanceof TypeError) throw new Error(`No se pudo conectar con el backend de MaestrIA (${API_BASE}). Revisá que esté corriendo y la configuración de CORS.`);
      throw error;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortFromCaller);
    }
  }

  function paginationPath(urlValue) {
    const base = new URL(`${API_BASE.replace(/\/+$/, '')}/`, window.location.origin);
    const target = new URL(urlValue, base);
    if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) {
      throw new Error('El backend devolvió un enlace de paginación fuera de la API configurada.');
    }
    return `${target.pathname.slice(base.pathname.length)}${target.search}`;
  }

  async function list(path, options = {}) {
    const initial = new URL(safePath(path), window.location.origin);
    if (!initial.searchParams.has('page_size')) initial.searchParams.set('page_size', '100');
    let nextPath = paginationPath(initial.href);
    const items = [];
    const maxPages = 100;

    for (let page = 0; page < maxPages; page += 1) {
      const payload = await request(nextPath, options);
      if (Array.isArray(payload)) return page ? items.concat(payload) : payload;
      if (!payload || !Array.isArray(payload.results)) return items;
      items.push(...payload.results);
      if (!payload.next) return items;
      nextPath = paginationPath(payload.next);
    }
    throw new Error(`El listado supera el límite de ${maxPages} páginas por consulta. Aplicá filtros para acotar los resultados.`);
  }
  // Política de contraseñas: debe coincidir con Supabase Auth
  // (Authentication → Sign In / Providers → Email): mínimo 8 caracteres y al menos
  // una minúscula, una mayúscula, un dígito y un símbolo. Supabase sólo cuenta
  // como letras las ASCII y estos símbolos.
  const PASSWORD_MIN_LENGTH = 8;
  const PASSWORD_SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";
  const PASSWORD_RULES = 'Al menos 8 caracteres, con una mayúscula, una minúscula, un número y un símbolo (por ejemplo ! ? # $ % & *).';

  function passwordPolicyError(password) {
    const value = String(password || '');
    if (value.length < PASSWORD_MIN_LENGTH) return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
    const missing = [];
    if (!/[a-z]/.test(value)) missing.push('una minúscula sin tilde (a-z)');
    if (!/[A-Z]/.test(value)) missing.push('una mayúscula sin tilde (A-Z)');
    if (!/[0-9]/.test(value)) missing.push('un número');
    if (![...value].some(char => PASSWORD_SYMBOLS.includes(char))) missing.push('un símbolo (por ejemplo ! ? # $ % & *)');
    if (!missing.length) return '';
    const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} y ${missing[missing.length - 1]}`;
    return `A la contraseña le falta ${list}.`;
  }

  // Errores frecuentes de Supabase Auth (registro, login y recuperación), por error_code.
  const AUTH_ERROR_MESSAGES = {
    email_address_invalid: 'Ese correo electrónico no es válido o no puede recibir mensajes. Usá una dirección real.',
    email_address_not_authorized: 'No se pueden enviar correos a esa dirección. Usá otra dirección.',
    user_already_exists: 'Ya existe una cuenta con ese correo. Ingresá o recuperá tu contraseña.',
    email_exists: 'Ya existe una cuenta con ese correo. Ingresá o recuperá tu contraseña.',
    invalid_credentials: 'El correo o la contraseña son incorrectos.',
    email_not_confirmed: 'Todavía no confirmaste tu correo. Revisá tu bandeja de entrada.',
    over_email_send_rate_limit: 'Se enviaron demasiados correos. Esperá unos minutos y volvé a intentar.',
    over_request_rate_limit: 'Demasiados intentos. Esperá unos minutos y volvé a intentar.',
    signup_disabled: 'El registro de cuentas nuevas está deshabilitado.',
  };

  // Supabase Auth responde en inglés; los rechazos de contraseña se traducen.
  function authErrorMessage(payload, statusCode) {
    if (payload?.error_code === 'weak_password') {
      const reasons = payload?.weak_password?.reasons || [];
      if (reasons.includes('pwned')) return 'Esa contraseña apareció en filtraciones conocidas. Elegí otra.';
      return `La contraseña no cumple los requisitos. ${PASSWORD_RULES}`;
    }
    if (payload?.error_code === 'same_password') return 'La nueva contraseña debe ser distinta de la actual.';
    const translated = AUTH_ERROR_MESSAGES[payload?.error_code];
    if (translated) return translated;
    return errorMessage(payload, statusCode);
  }

  async function authRequest(path, method, body) {
    const auth = await loadClientConfig();
    const response = await fetchWithTimeout(`${auth.supabaseUrl}/auth/v1/${path}`, {
      method, headers: { apikey: auth.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
    }, 20000, `Supabase (${auth.supabaseUrl})`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(authErrorMessage(payload, response.status));
    return payload;
  }

  async function authUserRequest(method, body, accessToken) {
    const auth = await loadClientConfig();
    const response = await fetchWithTimeout(`${auth.supabaseUrl}/auth/v1/user`, {
      method, headers: { apikey: auth.supabaseAnonKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
    }, 20000, `Supabase (${auth.supabaseUrl})`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(authErrorMessage(payload, response.status));
    return payload;
  }

  async function download(path, filename) {
    const response = await request(path, { rawResponse: true });
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl; anchor.download = filename || 'descarga';
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  window.MAESTRIA_API = Object.freeze({
    baseUrl: API_BASE,
    ApiError,
    request, list, download,
    get: (path, opts) => request(path, opts),
    post: (path, body, opts = {}) => request(path, { ...opts, method: 'POST', body }),
    patch: (path, body, opts = {}) => request(path, { ...opts, method: 'PATCH', body }),
    put: (path, body, opts = {}) => request(path, { ...opts, method: 'PUT', body }),
    delete: (path, opts = {}) => request(path, { ...opts, method: 'DELETE' }),
    upload: (path, formData, opts = {}) => request(path, { ...opts, method: 'POST', body: formData }),
    getSession, setSession, clearSession, validSession, refreshSession, loadClientConfig, authRequest, authUserRequest,
    passwordPolicyError, PASSWORD_RULES
  });
})();
