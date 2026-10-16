// The root README package table is generated from packages/*/package/package.json
// by scripts/readme-table.mjs; this fails when it drifts (#639, #647, #659).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkReadme, renderTable, START, END } from '../readme-table.mjs';

test('README.md package table matches packages/*/package/package.json', () => {
  const { ok } = checkReadme();
  assert.ok(ok, 'README.md package table is stale: run node scripts/readme-table.mjs --write');
});

function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'homescoop-readme-'));
  const pkg = (dir, json, builder = 'host') => {
    mkdirSync(join(root, 'packages', dir, 'package'), { recursive: true });
    writeFileSync(join(root, 'packages', dir, 'recipe.yaml'), `name: ${dir}\nbuilder: ${builder}\n`);
    writeFileSync(join(root, 'packages', dir, 'package', 'package.json'), JSON.stringify(json));
  };
  try {
    pkg('libpng', { name: '@x/wasm-libpng', version: '1.6.59-2', description: 'libpng | PNG' });
    pkg('ffmpeg', { name: '@x/wasm-ffmpeg', version: '0.0.0-retired', private: true }, 'retired');
    pkg('old', { name: '@x/old', version: '1.0.0-1', description: 'gone' }, 'retired');
    return fn(root, pkg);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('fixture: stale version and missing package are caught; private skipped; retired separate', () => {
  fixture((root, pkg) => {
    const table = renderTable(root);
    assert.match(table, /\[`@x\/wasm-libpng`\]\(packages\/libpng\) \| \*\*1\.6\.59-2\*\* \| libpng \\\| PNG \|/);
    assert.doesNotMatch(table, /ffmpeg/);
    assert.ok(table.indexOf('Retired') < table.indexOf('@x/old'));
    writeFileSync(join(root, 'README.md'), `# r\n\n${table}\n\ntail\n`);
    assert.equal(checkReadme(root).ok, true);
    // #639: version bumped in package.json, README row left behind.
    pkg('libpng', { name: '@x/wasm-libpng', version: '1.6.59-3', description: 'libpng | PNG' });
    assert.equal(checkReadme(root).ok, false);
    writeFileSync(join(root, 'README.md'), `# r\n\n${renderTable(root)}\n\ntail\n`);
    assert.equal(checkReadme(root).ok, true);
    // #639/#659: a new package with no row.
    pkg('bzip2', { name: '@x/wasm-bzip2', version: '1.0.8-3', description: 'bz' });
    assert.equal(checkReadme(root).ok, false);
  });
});

test('fixture: README without markers is an error, not a silent pass', () => {
  fixture((root) => {
    writeFileSync(join(root, 'README.md'), '# no table\n');
    assert.throws(() => checkReadme(root), new RegExp(START.slice(0, 20).replace(/[()]/g, '.')));
    assert.ok(END);
  });
});
