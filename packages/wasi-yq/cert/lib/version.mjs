import { readFileSync } from 'node:fs';

const RECIPE = new URL('../../recipe.yaml', import.meta.url);

export function recipeVersion (text = readFileSync(RECIPE, 'utf8')) {
  const m = /^version: "(\d+\.\d+\.\d+)"$/m.exec(text);
  if (!m) throw new Error('wasi-yq: recipe.yaml names no X.Y.Z version');
  return m[1];
}

export function versionStdout (want = recipeVersion()) {
  return `yq (https://github.com/mikefarah/yq/) version v${want}\n`;
}

export function reportsVersion (assert, text, want = recipeVersion()) {
  assert.equal(
    text,
    versionStdout(want),
    `yq --version names yq version v${want}, recipe.yaml's version: ${text}`,
  );
}
