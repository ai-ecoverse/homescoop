import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = '@ai-ecoverse/wasm-grep';

function workdir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'parity-at-record-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function tarball(dir, version, readme = 'grep\n') {
  const src = mkdtempSync(join(dir, 'src-'));
  mkdirSync(join(src, 'package'));
  writeFileSync(join(src, 'package', 'package.json'), JSON.stringify({ name: NAME, version }));
  writeFileSync(join(src, 'package', 'README.md'), readme);
  const tgz = join(src, 'package.tgz');
  execFileSync('bash', ['-c', `COPYFILE_DISABLE=1 tar -cf - -C "${src}" package | gzip -n > "${tgz}"`]);
  return tgz;
}


function fakeNpm(dir, { versions, latest, published, tags = {} }) {
  const bin = join(dir, 'fake-npm');
  writeFileSync(
    bin,
    `#!/usr/bin/env bash
case "$1" in
  view) echo '${JSON.stringify({ versions, 'dist-tags': { latest, ...tags } })}' ;;
  pack) cp "${published}" "$4/published.tgz" ;;
esac
`,
  );
  chmodSync(bin, 0o755);
  return bin;
}









async function registry(t, routes) {
  const server = createServer((req, res) => {
    const r = routes[decodeURIComponent(req.url)];
    res.writeHead(r ? r[0] : 404, { 'content-type': 'application/json' });
    res.end(r ? JSON.stringify(r[1]) : '{}');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

function publishGate(url, tgz, certified, npm = '/nonexistent/npm') {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [join(scripts, 'assert-certified-publish.mjs'), tgz, '--npm', NAME, '--certified', certified], { env: { ...process.env, HOMESCOOP_REGISTRY: url, HOMESCOOP_NPM: npm, HOMESCOOP_NPM_RETRY_S: '0' } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (status) => ok({ status, out }));
  });
}

test('#891 at publish: assert-certified-publish refuses a certified version that sorts below npm latest', async (t) => {
  const dir = workdir(t);
  const tgz = tarball(dir, '3.12.0-4');
  const sha = createHash('sha256').update(readFileSync(tgz)).digest('hex');
  const behind = await registry(t, { [`/${NAME}/latest`]: [200, { version: '3.12.0-5' }] });
  const b = await publishGate(behind, tgz, sha);
  assert.equal(b.status, 2, b.out);
  assert.match(b.out, /refuse OIDC publish of @ai-ecoverse\/wasm-grep@3\.12\.0-4: it sorts below npm latest 3\.12\.0-5/);
  const above = await registry(t, { [`/${NAME}/latest`]: [200, { version: '3.12.0-3' }] });
  assert.equal((await publishGate(above, tgz, sha)).status, 0);
  const unknown = await registry(t, {});
  assert.equal((await publishGate(unknown, tgz, sha)).status, 0);
  const integrity = `sha512-${createHash('sha512').update(readFileSync(tgz)).digest('base64')}`;
  const already = await registry(t, { [`/${NAME}/3.12.0-4`]: [200, { version: '3.12.0-4', dist: { integrity } }], [`/${NAME}/latest`]: [200, { version: '3.12.0-5' }] });
  assert.equal((await publishGate(already, tgz, sha)).status, 10);
  const broken = await registry(t, { [`/${NAME}/latest`]: [500, {}] });
  assert.equal((await publishGate(broken, tgz, sha)).status, 2);
  const odd = await registry(t, { [`/${NAME}/latest`]: [200, { nope: 1 }] });
  assert.equal((await publishGate(odd, tgz, sha)).status, 2);
});

test('#971 at publish: a version already on npm skips only with the same contents; other contents fail instead of skipping', async (t) => {
  const dir = workdir(t);
  const tgz = tarball(dir, '3.12.0-5');
  const sha = createHash('sha256').update(readFileSync(tgz)).digest('hex');
  const url = await registry(t, { [`/${NAME}/3.12.0-5`]: [200, { version: '3.12.0-5', dist: { integrity: 'sha512-other' } }], [`/${NAME}/latest`]: [200, { version: '3.12.0-5' }] });
  const repacked = await publishGate(url, tgz, sha, fakeNpm(dir, { versions: ['3.12.0-5'], latest: '3.12.0-5', published: tarball(dir, '3.12.0-5') }));
  assert.equal(repacked.status, 10, repacked.out);
  assert.match(repacked.out, /same contents — skip publish/);
  const drift = await publishGate(url, tgz, sha, fakeNpm(dir, { versions: ['3.12.0-5'], latest: '3.12.0-5', published: tarball(dir, '3.12.0-5', 'stripped\n') }));
  assert.equal(drift.status, 2, drift.out);
  assert.match(drift.out, /refuse: @ai-ecoverse\/wasm-grep@3\.12\.0-5 is already on npm with different contents \(1 entry\), so these bytes would never ship/);
  assert.match(drift.out, /package\/README\.md: content/);
  const down = join(dir, 'down-npm');
  writeFileSync(down, '#!/usr/bin/env bash\necho "npm error code ETIMEDOUT" >&2\nexit 1\n');
  chmodSync(down, 0o755);
  const unknown = await publishGate(url, tgz, sha, down);
  assert.equal(unknown.status, 2, unknown.out);
  assert.match(unknown.out, /is on npm, and comparing it failed/);
});


function runPublish(t, dir, { url, published, sha, tag = 'latest', npmScript = null }) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, 'npm'),
    `#!/usr/bin/env bash
case "$1" in
  -v) echo 11.0.0 ;;
  publish) ${npmScript ?? 'echo "npm error 403 You cannot publish over the previously published versions: 3.12.0-6." >&2; exit 1'} ;;
  pack) cp "${published}" "$4/published.tgz" ;;
esac
`,
  );
  chmodSync(join(bin, 'npm'), 0o755);
  const temp = join(dir, 'runner-temp');
  mkdirSync(temp, { recursive: true });
  const script = `bash scripts/oidc-publish.sh ${JSON.stringify(join(temp, 'package.tgz'))} ${NAME} ${JSON.stringify(tag)} ${sha}`;
  return new Promise((ok) => {
    const p = spawn('bash', ['-c', script], {
      cwd: join(scripts, '..'),
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: dir, GITHUB_OUTPUT: join(dir, 'gh-output'), NPM_CONFIG_USERCONFIG: '', ACTIONS_ID_TOKEN_REQUEST_URL: 'http://127.0.0.1:9/oidc', HOMESCOOP_REGISTRY: url, HOMESCOOP_NPM: join(bin, 'npm'), HOMESCOOP_NPM_RETRY_S: '0', NPM: NAME, TAG: tag, CERTIFIED: sha },
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (status) => ok({ status, out, temp }));
  });
}

test('#971 in ladder-build: a lost publish race ("cannot publish over") succeeds only when npm has these contents', async (t) => {
  const dir = workdir(t);
  const tgz = tarball(dir, '3.12.0-6');
  const sha = createHash('sha256').update(readFileSync(tgz)).digest('hex');
  let published = false;
  const server = createServer((req, res) => {
    const path = decodeURIComponent(req.url);
    if (path === `/${NAME}/latest`) return res.writeHead(200).end(JSON.stringify({ version: published ? '3.12.0-6' : '3.12.0-5' }));
    if (path === `/${NAME}/3.12.0-6` && published) return res.writeHead(200).end(JSON.stringify({ version: '3.12.0-6', dist: { integrity: 'sha512-other' } }));
    if (path === `/${NAME}/3.12.0-6`) {
      published = true;
      return res.writeHead(404).end('{}');
    }
    res.writeHead(404).end('{}');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(join(dir, 'pkg.tgz'), readFileSync(tgz));
  const prep = (d) => {
    mkdirSync(join(d, 'runner-temp'), { recursive: true });
    writeFileSync(join(d, 'runner-temp', 'package.tgz'), readFileSync(tgz));
  };
  const other = join(dir, 'other');
  mkdirSync(other);
  prep(other);
  const lost = await runPublish(t, other, { url, published: tarball(dir, '3.12.0-6', 'someone else\n'), sha });
  assert.equal(lost.status, 1, lost.out);
  assert.match(lost.out, /publish: FAIL @ai-ecoverse\/wasm-grep@3\.12\.0-6: on npm, but not with these contents \(certified-publish exit 2\); these bytes never shipped/);
  published = false;
  const same = join(dir, 'same');
  mkdirSync(same);
  prep(same);
  const won = await runPublish(t, same, { url, published: tgz, sha });
  assert.equal(won.status, 0, won.out);
  assert.match(won.out, /same contents — skip publish/);
  assert.match(won.out, /^publish: PASS @ai-ecoverse\/wasm-grep@3\.12\.0-6 \(already on npm, same contents\)$/m);
});

async function channelRegistry(t, routes) {
  const server = createServer((req, res) => {
    const r = routes[decodeURIComponent(req.url)];
    res.writeHead(r ? 200 : 404).end(JSON.stringify(r ?? {}));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

async function dryPublish(t, dir, { routes, tag, version = '3.15.0-1' }) {
  const tgz = tarball(dir, version);
  const sha = createHash('sha256').update(readFileSync(tgz)).digest('hex');
  const d = mkdtempSync(join(dir, 'dry-'));
  mkdirSync(join(d, 'runner-temp'), { recursive: true });
  writeFileSync(join(d, 'runner-temp', 'package.tgz'), readFileSync(tgz));
  const log = join(d, 'publish.log');
  const url = await channelRegistry(t, routes);
  const r = await runPublish(t, d, { url, published: tgz, sha, tag, npmScript: `shift; printf '%s\\n' "$@" > "${log}"; exit 0` });
  let argv = null;
  try {
    argv = readFileSync(log, 'utf8').trim().split('\n');
  } catch {}
  return { ...r, argv, tgz: join(d, 'runner-temp', 'package.tgz') };
}

test('dry run of ladder-build publish: a tagged recipe publishes with --tag python3.15 and never --tag latest', async (t) => {
  const dir = workdir(t);
  const r = await dryPublish(t, dir, { tag: 'python3.15', routes: { [`/${NAME}/latest`]: { version: '3.14.2-28' } } });
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.argv, [r.tgz, '--access', 'public', '--tag', 'python3.15']);
  assert.match(r.out, /certified-publish: PASS @ai-ecoverse\/wasm-grep@3\.15\.0-1 --tag python3\.15/);
  const next = await dryPublish(t, dir, { tag: 'python3.15', version: '3.15.0-2', routes: { [`/${NAME}/latest`]: { version: '3.14.2-28' }, [`/${NAME}/python3.15`]: { version: '3.15.0-1' } } });
  assert.equal(next.status, 0, next.out);
  assert.deepEqual(next.argv, [next.tgz, '--access', 'public', '--tag', 'python3.15']);
});

test('dry run of ladder-build publish: an untagged recipe still publishes with --tag latest, judged against latest only', async (t) => {
  const dir = workdir(t);
  const r = await dryPublish(t, dir, { tag: 'latest', version: '3.14.2-29', routes: { [`/${NAME}/latest`]: { version: '3.14.2-28' }, [`/${NAME}/python3.15`]: { version: '3.15.0-1' } } });
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.argv, [r.tgz, '--access', 'public', '--tag', 'latest']);
});

test('NEGATIVE: dry run of ladder-build publish refuses before npm publish: behind its tag, no latest yet, a reserved or empty tag', async (t) => {
  const dir = workdir(t);
  const behind = await dryPublish(t, dir, { tag: 'python3.15', version: '3.15.0-1', routes: { [`/${NAME}/latest`]: { version: '3.14.2-28' }, [`/${NAME}/python3.15`]: { version: '3.15.0-2' } } });
  assert.notEqual(behind.status, 0);
  assert.equal(behind.argv, null);
  assert.match(behind.out, /sorts below npm python3\.15 3\.15\.0-2, and --tag python3\.15 would move python3\.15 back/);
  const first = await dryPublish(t, dir, { tag: 'python3.15', routes: {} });
  assert.notEqual(first.status, 0);
  assert.equal(first.argv, null);
  assert.match(first.out, /npm has no latest .* becomes latest whatever its tag/);
  for (const tag of ['next', 'certified', '', 'py3']) {
    const bad = await dryPublish(t, dir, { tag, routes: { [`/${NAME}/latest`]: { version: '3.14.2-28' } } });
    assert.notEqual(bad.status, 0, tag);
    assert.equal(bad.argv, null, tag);
  }
  const untaggedBehind = await dryPublish(t, dir, { tag: 'latest', version: '3.14.2-27', routes: { [`/${NAME}/latest`]: { version: '3.14.2-28' } } });
  assert.notEqual(untaggedBehind.status, 0);
  assert.equal(untaggedBehind.argv, null);
});
