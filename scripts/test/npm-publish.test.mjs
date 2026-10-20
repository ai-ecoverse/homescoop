import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publish } from '../npm-publish.mjs';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = '@ai-ecoverse/homescoop-test-publish';
const VERSION = '1.0.0-1';

function tarball(dir, file, body) {
  const src = join(dir, `src-${file}`);
  mkdirSync(join(src, 'package'), { recursive: true });
  writeFileSync(join(src, 'package', 'package.json'), JSON.stringify({ name: NAME, version: VERSION }));
  writeFileSync(join(src, 'package', 'index.js'), body);
  const out = join(dir, file);
  execFileSync('bash', ['-c', `COPYFILE_DISABLE=1 tar -cf - -C "${src}" package | gzip -n > "${out}"`]);
  return out;
}

const sha = (buf, alg = 'sha256', enc = 'hex') => createHash(alg).update(buf).digest(enc);

async function setup(t, { publishOut = '', publishCode = 0 } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'npm-publish-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tgz = tarball(dir, 'package.tgz', 'ours\n');
  const other = tarball(dir, 'other.tgz', 'theirs\n');
  const log = join(dir, 'npm.log');
  const npm = join(dir, 'npm');
  writeFileSync(
    npm,
    [
      '#!/bin/bash',
      `echo "$*" >> "${log}"`,
      'if [[ "$1" == pack ]]; then',
      `  cp "${other}" "$4/other.tgz"`,
      '  exit 0',
      'fi',
      'if [[ "$1" == publish ]]; then',
      `  printf '%s\\n' "${publishOut}"`,
      `  exit ${publishCode}`,
      'fi',
      'exit 9',
      '',
    ].join('\n'),
  );
  chmodSync(npm, 0o755);
  const state = { serve: null, hits: 0 };
  const server = createServer((req, res) => {
    state.hits++;
    const doc = state.serve && req.url.endsWith(`/${VERSION}`) ? state.serve() : null;
    res.statusCode = doc ? 200 : 404;
    res.end(JSON.stringify(doc ?? {}));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const env = { ...process.env, HOMESCOOP_NPM: npm, HOMESCOOP_REGISTRY: `http://127.0.0.1:${server.address().port}` };
  const integrity = (file) => `sha512-${sha(readFileSync(file), 'sha512', 'base64')}`;
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
  return { dir, tgz, other, env, state, integrity, calls, certified: sha(readFileSync(tgz)) };
}

const noSleep = async () => {};

test('a lagging registry (still 404 right after a successful npm publish) does not fail the publish', async (t) => {
  const s = await setup(t, { publishOut: `+ ${NAME}@${VERSION}` });
  const r = await publish({ tgz: s.tgz, name: NAME, tag: 'latest', certified: s.certified, env: s.env, sleep: noSleep });
  assert.deepEqual(r, { code: 0, verdict: `PASS ${NAME}@${VERSION} (published)` });
  assert.deepEqual(s.calls(), [`publish ${s.tgz} --access public --tag latest`]);
  assert.equal(s.state.serve, null, 'the registry never served the version');
});

test('NEGATIVE: a same-version publish with different bytes is refused before npm publish runs', async (t) => {
  const s = await setup(t);
  s.state.serve = () => ({ dist: { integrity: s.integrity(s.other) } });
  const r = await publish({ tgz: s.tgz, name: NAME, tag: 'latest', certified: s.certified, env: s.env, sleep: noSleep });
  assert.equal(r.code, 2);
  assert.match(r.verdict, /^FAIL .*certified-publish refused it \(exit 2\)/);
  assert.ok(!s.calls().some((c) => c.startsWith('publish')), 'npm publish never ran');
});

test('a re-run that npm answers "cannot publish over" passes when npm has the same bytes, and fails when it has others', async (t) => {
  const s = await setup(t, { publishOut: 'npm error 403 You cannot publish over the previously published versions: 1.0.0-1.', publishCode: 1 });
  let gets = 0;
  s.state.serve = () => (++gets <= 2 ? null : { dist: { integrity: s.integrity(s.tgz) } });
  const same = await publish({ tgz: s.tgz, name: NAME, tag: 'latest', certified: s.certified, env: s.env, sleep: noSleep });
  assert.deepEqual(same, { code: 0, verdict: `PASS ${NAME}@${VERSION} (already on npm, same contents)` });
  gets = 0;
  s.state.serve = () => (++gets <= 1 ? null : { dist: { integrity: s.integrity(s.other) } });
  const diff = await publish({ tgz: s.tgz, name: NAME, tag: 'latest', certified: s.certified, env: s.env, sleep: noSleep });
  assert.equal(diff.code, 1);
  assert.match(diff.verdict, /^FAIL .*not with these contents/);
});

test('an npm error fails the publish; a forged certified sha never reaches npm', async (t) => {
  const s = await setup(t, { publishOut: 'npm error code E500', publishCode: 1 });
  const failed = await publish({ tgz: s.tgz, name: NAME, tag: 'latest', certified: s.certified, env: s.env, sleep: noSleep });
  assert.deepEqual(failed, { code: 1, verdict: `FAIL ${NAME}@${VERSION}: npm publish exited 1` });
  const before = s.calls().length;
  const forged = await publish({ tgz: s.tgz, name: NAME, tag: 'latest', certified: 'f'.repeat(64), env: s.env, sleep: noSleep });
  assert.equal(forged.code, 2);
  assert.equal(s.calls().length, before);
});

test('the CLI prints one publish verdict line, and gate.mjs passes it', async (t) => {
  const s = await setup(t);
  const out = await new Promise((resolve) => {
    const p = spawn(process.execPath, [join(scripts, 'gate.mjs'), 'publish', '--', process.execPath, join(scripts, 'npm-publish.mjs'), s.tgz, '--npm', NAME, '--tag', 'latest', '--certified', s.certified], { env: s.env });
    let text = '';
    p.stdout.on('data', (d) => (text += d));
    p.stderr.on('data', (d) => (text += d));
    p.on('close', (code) => resolve({ code, text }));
  });
  assert.equal(out.code, 0, out.text);
  assert.deepEqual(out.text.match(/^publish: .*$/gm), [`publish: PASS ${NAME}@${VERSION} (published)`]);
});
