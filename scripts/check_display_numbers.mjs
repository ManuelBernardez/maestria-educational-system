// Pruebas unitarias del formato numérico del espacio docente (sin dependencias).
// Contrato (README, v1.0.6/v1.0.7): ocultar la escala de almacenamiento de PostgreSQL,
// mostrar como máximo dos decimales significativos con coma decimal y no inventar
// decimales que el docente no ingresó. Uso: node scripts/check_display_numbers.mjs
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// utils.js importa state.js, que resuelve nodos del DOM al cargarse.
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const utilsUrl = pathToFileURL(path.join(root, 'frontend/js/modules/core/utils.js')).href;
const { formatInputNumber, formatNumber } = await import(utilsUrl);

const inputCases = [
  ['10.000000000000000000', '10'],
  ['8.500000000000000000', '8.5'],
  ['8.250', '8.25'],
  ['0.000000000000000000', '0'],
  ['-0.000', '0'],
  ['7', '7'],
  [7.5, '7.5'],
  ['', ''],
  [null, ''],
  [undefined, ''],
  ['no numérico', 'no numérico'],
];

const displayCases = [
  ['10.000000000000000000', '10'],
  ['8.500000000000000000', '8,5'],
  ['8.250000000000000000', '8,25'],
  ['7.125000000000000000', '7,13'],
  ['0.001', '0'],
  ['-0.001', '0'],
  ['100', '100'],
  [null, '—'],
  ['', '—'],
];

let failures = 0;
const run = (label, fn, cases) => {
  for (const [input, expected] of cases) {
    try {
      assert.equal(fn(input), expected);
    } catch {
      failures += 1;
      console.error(`ERROR: ${label}(${JSON.stringify(input)}) = ${JSON.stringify(fn(input))}; se esperaba ${JSON.stringify(expected)}`);
    }
  }
};

run('formatInputNumber', formatInputNumber, inputCases);
run('formatNumber', formatNumber, displayCases);

if (failures) {
  console.error(`${failures} caso(s) de formato numérico fallaron.`);
  process.exit(1);
}
console.log(`OK: formato numérico (${inputCases.length + displayCases.length} casos).`);
