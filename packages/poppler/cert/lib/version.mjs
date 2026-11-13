import { readFileSync } from 'node:fs';

const RECIPE = new URL('../../recipe.yaml', import.meta.url);

export function recipeVersion (text = readFileSync(RECIPE, 'utf8')) {
  const m = /^version: "(\d+\.\d+\.\d+)"$/m.exec(text);
  if (!m) throw new Error('poppler: recipe.yaml names no X.Y.Z version');
  return m[1];
}

export function reportsVersion (assert, text, util, want = recipeVersion()) {
  assert.equal(
    text.split('\n')[0],
    `${util} version ${want}`,
    `${util} reports Poppler on the first stderr line, recipe.yaml's version: ${text}`,
  );
}
