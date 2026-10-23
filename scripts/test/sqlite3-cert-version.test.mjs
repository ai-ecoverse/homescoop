import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { builtVersion, upstreamOf } from '../../packages/sqlite3/cert/checklist.mjs';

const dir = new URL('../../packages/sqlite3/', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package/package.json', dir), 'utf8'));
const recipe = readFileSync(new URL('recipe.yaml', dir), 'utf8');

function fakeCtx({ upstream, reports, date = '2026-10-20 12:00:00' }) {
  const calls = [];
  return {
    calls,
    assert,
    npmName: pkg.name,
    async read(path) {
      if (path !== `/node_modules/${pkg.name}/package.json`) return null;
      return upstream === undefined ? null : JSON.stringify({ name: pkg.name, homescoop: { recipe: 'sqlite3', ...(upstream && { upstream }) } });
    },
    async run(argv) {
      calls.push(argv.join(' '));
      if (argv[1] === '-version') return { status: 0, stdout: `${reports} ${date} abcdef0123456789 (64-bit)\n`, stderr: '' };
      if (argv.at(-1) === 'select sqlite_version();') return { status: 0, stdout: `${reports}\n`, stderr: '' };
      return { status: 1, stdout: '', stderr: `unexpected ${argv.join(' ')}` };
    },
  };
}

test('recipe.yaml, package.json and the spec agree on the upstream', () => {
  assert.match(recipe, new RegExp(`^version: "${pkg.homescoop.upstream.replaceAll('.', '\\.')}"$`, 'm'));
});

test('the spec names no upstream version literal, so a Renovate bump needs no cert edit (homescoop#1791)', () => {
  const src = readFileSync(new URL('cert/checklist.mjs', dir), 'utf8');
  const v = pkg.homescoop.upstream;
  assert.ok(!src.includes(v), `checklist.mjs names ${v}`);
  assert.ok(!src.includes(v.replaceAll('.', '\\.')), `checklist.mjs names ${v} as a regex`);
});

test('a binary reporting the installed package upstream passes', async () => {
  const ctx = fakeCtx({ upstream: '3.54.1', reports: '3.54.1' });
  assert.equal(await upstreamOf(ctx), '3.54.1');
  assert.equal(await builtVersion(ctx), '3.54.1');
  assert.deepEqual(ctx.calls, ['sqlite3 -version', 'sqlite3 :memory: select sqlite_version();']);
});

test('a future upstream passes with no spec change', async () => {
  assert.equal(await builtVersion(fakeCtx({ upstream: '3.55.0', reports: '3.55.0' })), '3.55.0');
});

test('NEGATIVE: a deliberately wrong expected version fails', async () => {
  await assert.rejects(builtVersion(fakeCtx({ upstream: '3.54.1', reports: '3.54.1' }), '3.54.0'), /sqlite3 -version reports 3\.54\.0/);
  await assert.rejects(builtVersion(fakeCtx({ upstream: '3.54.1', reports: '3.54.1' }), '3.5.1'), /sqlite3 -version reports 3\.5\.1/);
});

test('NEGATIVE: a binary that is not the upstream its package names fails', async () => {
  await assert.rejects(builtVersion(fakeCtx({ upstream: '3.54.1', reports: '3.54.0' })), /sqlite3 -version reports 3\.54\.1/);
  await assert.rejects(builtVersion(fakeCtx({ upstream: '3.54.1', reports: '3.54.10' })), /sqlite3 -version reports 3\.54\.1/);
});

test('NEGATIVE: the -version line and sqlite_version() are checked separately', async () => {
  const ctx = fakeCtx({ upstream: '3.54.1', reports: '3.54.1' });
  const run = ctx.run;
  ctx.run = async (argv) => (argv[1] === '-version' ? run(argv) : { status: 0, stdout: '3.54.0\n', stderr: '' });
  await assert.rejects(builtVersion(ctx), /sqlite_version\(\) is 3\.54\.1/);
});

test('NEGATIVE: a package with no package.json or no homescoop.upstream fails', async () => {
  await assert.rejects(builtVersion(fakeCtx({ upstream: undefined, reports: '3.54.1' })), /has a package\.json/);
  await assert.rejects(builtVersion(fakeCtx({ upstream: '', reports: '3.54.1' })), /names the upstream it was built from/);
});
