import { readFileSync } from 'node:fs';

const RECIPE = new URL('../../recipe.yaml', import.meta.url);

export function recipeVersion (text = readFileSync(RECIPE, 'utf8')) {
  const m = /^version: "(\d+\.\d+\.\d+)"$/m.exec(text);
  if (!m) throw new Error('rsync: recipe.yaml names no X.Y.Z version');
  return m[1];
}

const esc = (v) => v.replaceAll('.', '\\.');

export function reportsVersion (assert, text, want = recipeVersion()) {
  assert.match(
    text,
    new RegExp(`^rsync {2}version ${esc(want)} {2}protocol version 33$`, 'm'),
    `rsync --version names rsync version ${want}, recipe.yaml's version: ${text}`,
  );
}
