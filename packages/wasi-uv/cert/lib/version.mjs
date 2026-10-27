import { readFileSync } from 'node:fs';

const RECIPE = new URL('../../recipe.yaml', import.meta.url);

export function recipeVersion (text = readFileSync(RECIPE, 'utf8')) {
  const m = /^version: "(\d+\.\d+\.\d+)"$/m.exec(text);
  if (!m) throw new Error('wasi-uv: recipe.yaml names no X.Y.Z version');
  return m[1];
}

const esc = (v) => v.replaceAll('.', '\\.');

export const REPORTS = {
  'uv --version': (v) => new RegExp(`^uv ${esc(v)} \\((?:.+ )?wasm32-wasip1-threads\\)$`, 'm'),
  'pyvenv.cfg': (v) => new RegExp(`^uv = ${esc(v)}$`, 'm'),
  'uvx --version': (v) => new RegExp(`^uvx ${esc(v)}(?: |$)`, 'm'),
};

export function reportsVersion (assert, what, text, want = recipeVersion()) {
  const pattern = REPORTS[what];
  if (!pattern) throw new Error(`wasi-uv: no version pattern for ${what}`);
  assert.match(text, pattern(want), `${what} names uv ${want}, recipe.yaml's version: ${text}`);
}

export function olderThan (a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
}
