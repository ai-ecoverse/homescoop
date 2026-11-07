import { readFileSync } from 'node:fs';

const RECIPE = new URL('../../recipe.yaml', import.meta.url);

export function recipeVersion (text = readFileSync(RECIPE, 'utf8')) {
  const m = /^version: "(\d+\.\d+\.\d+)"$/m.exec(text);
  if (!m) throw new Error('cmake: recipe.yaml names no X.Y.Z version');
  return m[1];
}

export function seriesOf (version) {
  const m = /^(\d+\.\d+)\.\d+$/.exec(version);
  if (!m) throw new Error(`cmake: ${version} is not X.Y.Z`);
  return m[1];
}

const esc = (v) => v.replaceAll('.', '\\.');

export function reportsVersion (assert, text, want = recipeVersion()) {
  assert.match(
    text,
    new RegExp(`^cmake version ${esc(want)}\\n`),
    `cmake --version names cmake version ${want}, recipe.yaml's version: ${text}`,
  );
}
