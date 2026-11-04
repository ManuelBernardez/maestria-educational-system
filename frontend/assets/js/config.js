(() => {
  'use strict';
  const local = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const declared = document.querySelector('meta[name="maestria-api-url"]')?.content || '';
  const configured = window.MAESTRIA_API_URL || declared;
  // Production is one-origin: the browser calls /api on the same host.
  // For local static preview (port 5500), use the Django dev server on 8000.
  const fallback = local
    ? 'http://127.0.0.1:8000/api'
    : `${window.location.origin}/api`;
  window.MAESTRIA_CONFIG = Object.freeze({
    apiBaseUrl: String(configured || fallback).replace(/\/+$/, '')
  });
})();
