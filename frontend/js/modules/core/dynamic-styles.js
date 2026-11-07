/**
 * Propiedades CSS calculadas en tiempo de ejecución (p. ej. la posición de un menú
 * anclado) sin atributos `style`: se escriben en una hoja construida y adoptada por
 * el documento, compatible con la CSP estricta (style-src 'self').
 * Sólo acepta valores numéricos con unidad para evitar inyectar CSS arbitrario.
 */
const sheet = typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in document ? new CSSStyleSheet() : null;
if (sheet) document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

const rules = new Map();
const SAFE_VALUE = /^-?\d+(\.\d+)?(px|%|rem)$/;

export function setCustomProperties(selector, properties) {
  if (!sheet) return;
  const declarations = Object.entries(properties)
    .filter(([name, value]) => /^--[a-z-]+$/.test(name) && SAFE_VALUE.test(String(value)))
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
  rules.set(selector, declarations);
  sheet.replaceSync([...rules].map(([rule, body]) => `${rule}{${body}}`).join('\n'));
}
