import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const renovate = JSON.parse(readFileSync(join(root, 'renovate.json'), 'utf8'));
const manager = renovate.customManagers.find((m) => m.managerFilePatterns.some((p) => p.includes('recipe')));
const matcher = new RegExp(manager.matchStrings[0], 'g');

function pins() {
  const out = [];
  for (const dir of readdirSync(join(root, 'packages')).sort()) {
    const file = join(root, 'packages', dir, 'recipe.yaml');
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    const comments = text.match(/^# renovate:.*$/gm) || [];
    const found = [...text.matchAll(matcher)].map((m) => m.groups);
    out.push({ dir, text, comments, found });
  }
  return out;
}

const UNREAD = {
};

test('every recipe # renovate: comment is read by the recipe manager, with the version: line it pins', () => {
  for (const { dir, text, comments, found } of pins()) {
    if (UNREAD[dir]) {
      assert.equal(found.length, 0, `${dir} is read by the manager now; drop it from UNREAD`);
      continue;
    }
    assert.equal(found.length, comments.length, `${dir}: ${comments.length} comment(s), the manager reads ${found.length}`);
    const version = text.match(/^version:\s*["']?([^"'\s]+)/m)?.[1];
    if (found.length) assert.equal(found[0].currentValue, version, `${dir}: the manager pins ${found[0].currentValue}, the recipe says ${version}`);
  }
});

const DEAD = {};

test('every extractVersion compiles and has a version group (Renovate keeps only that group)', () => {
  for (const { dir, found } of pins()) {
    if (DEAD[dir]) {
      assert.ok(found.every((g) => !/\(\?<version>/.test(g.extractVersion || '')), `${dir} has a version group now; drop it from DEAD`);
      continue;
    }
    for (const g of found) {
      if (!g.extractVersion) continue;
      assert.doesNotThrow(() => new RegExp(g.extractVersion), `${dir}: ${g.extractVersion}`);
      assert.match(g.extractVersion, /\(\?<version>/, `${dir}: extractVersion ${g.extractVersion} has no (?<version>…) group, so Renovate drops every release`);
    }
  }
});

test('every custom.* datasource is defined in customDatasources', () => {
  const custom = renovate.customDatasources || {};
  for (const { dir, found } of pins()) {
    for (const g of found) {
      if (!g.datasource.startsWith('custom.')) continue;
      const def = custom[g.datasource.slice('custom.'.length)];
      assert.ok(def, `${dir}: ${g.datasource} is not in renovate.json customDatasources`);
      assert.match(def.defaultRegistryUrlTemplate, /^https:\/\//, `${dir}: ${g.datasource} has no https registry URL`);
    }
  }
});

const LISTINGS = {
  binutils: {
    hrefs: ['../', 'binutils-2.46.0.tar.xz', 'binutils-2.46.0.tar.xz.sig', 'binutils-2.46.1.tar.xz', 'binutils-2.47.tar.bz2', 'binutils-2.47.tar.xz', 'binutils-2.47.tar.xz.sig', 'binutils-with-gold-2.44.tar.xz', 'binutils-2.9.1a.tar.gz'],
    want: ['2.46.0', '2.46.1', '2.47'],
  },
  curl: {
    hrefs: ['/download/curl-8.23.0.tar.bz2', '/download/curl-8.23.0.tar.xz', '/download/curl-8.23.0.tar.xz.asc', '/download/curl-8.22.0.tar.xz', '/download/curl-8.22.0.zip', '/docs/', 'curl-7.88.1.tar.xz'],
    want: ['8.23.0', '8.22.0'],
  },
  freetype: {
    hrefs: ['freetype-2.13.3.tar.gz', 'freetype-2.13.3.tar.gz.sig', 'freetype-2.15.0.tar.gz', 'freetype-2.15.0.tar.xz', 'freetype-doc-2.15.0.tar.gz', 'ft2demos-2.15.0.tar.gz', 'freetype-old/'],
    want: ['2.13.3', '2.15.0'],
  },
};

test('binutils, curl and freetype: their extractVersion turns the release directory into versions', () => {
  const byDir = Object.fromEntries(pins().map((p) => [p.dir, p.found[0]]));
  for (const [dir, { hrefs, want }] of Object.entries(LISTINGS)) {
    const g = byDir[dir];
    assert.ok(g, `${dir} has no renovate pin`);
    assert.equal(g.datasource, `custom.${dir}`);
    const re = new RegExp(g.extractVersion);
    const got = hrefs.map((h) => re.exec(h)?.groups?.version).filter(Boolean);
    assert.deepEqual(got, want, dir);
  }
});
