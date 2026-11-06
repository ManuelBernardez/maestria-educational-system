/**
 * Infrastructure adapter for the shared HTTP/Auth client.
 *
 * Importing the legacy IIFE here makes initialization order explicit: config is
 * loaded first, then the client attaches its public API, then domain modules use
 * the typed-by-contract `api` surface. Public pages can keep their classic scripts
 * until they are migrated to ES modules.
 */
import '../../config.js';
import '../../api.js';

const client = window.MAESTRIA_API;

if (!client) {
  throw new Error('No se pudo inicializar el cliente HTTP de MaestrIA.');
}

export const api = client;
export default api;
