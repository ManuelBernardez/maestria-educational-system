import assert from 'node:assert/strict';

// The formatting helpers are pure, but their module also imports the browser state.
globalThis.document = { querySelector: () => null };
const { formatInputNumber, formatNumber } = await import('../frontend/js/modules/core/utils.js');

const cases = [
  ['10.000000000000000000', '10'],
  ['6.500000000000000000', '6,5'],
  ['8.250000000000000000', '8,25'],
  [7.75, '7,75'],
  [0, '0'],
  [null, '—'],
];
for (const [input, expected] of cases) {
  assert.equal(formatNumber(input), expected, `formatNumber(${String(input)})`);
}
assert.equal(formatInputNumber('10.000000000000000000'), '10');
assert.equal(formatInputNumber('8.250000000000000000'), '8.25');
process.stdout.write(`OK: ${cases.length} casos de visualización numérica y 2 casos de entrada.\n`);
