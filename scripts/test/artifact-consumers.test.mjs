import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LADDER, githubIo, resolvePackage, tarballProblem, zipDigestProblem } from '../ladder-merge-resolve.mjs';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const workflows = join(scripts, '..', '.github', 'workflows');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const D = (s) => `sha256:${sha(s)}`;

const NAME = '@ai-ecoverse/wasm-grep';
const VERSION = '3.12.0-2';
const HEAD = 'dea953c9b0682a7f6bce2a102c07652d4b0d5f9f';
const PR = { number: 7, head: HEAD, body: '', author: 'trieloff' };

function io({ artifacts, tarballs = {}, conclusions = {} }) {
  return {
    published: async () => false,
    pullRequest: async () => PR,
    changedFiles: async () => ['packages/grep/recipe.yaml'],
    artifacts: async () => artifacts,
    run: async (id) => ({ id, path: LADDER, event: 'pull_request', head_sha: HEAD, status: 'completed', conclusion: conclusions[id] ?? 'success' }),
    jobs: async () => [{ name: 'ci', conclusion: 'success' }],
    download: async (a) => tarballs[a.id] ?? {},
  };
}
const ladderArt = (id, digest) => ({ id, name: 'host-grep-pr7', expired: false, digest, created_at: new Date(Date.UTC(2026, 9, 17, 0, 0, id)).toISOString(), workflow_run: { id: 100 + id, head_sha: HEAD } });
const ctx = () => ({ pkg: 'grep', name: NAME, version: VERSION, assumeUnpublished: false });

test('ladder-merge-resolve: a red PR run is refused, whatever its artifact holds (the review is part of the run)', async () => {
  const tgz = { sha: 'a'.repeat(64), recorded: 'a'.repeat(64), name: NAME, version: VERSION };
  await assert.rejects(resolvePackage(ctx(), io({ artifacts: [ladderArt(1, D('one'))], tarballs: { 1: tgz }, conclusions: { 101: 'failure' } })), /run 101 concluded failure/);
});

test('ladder-merge-resolve: the newest green artifact is published with its own sha; a tarball that disagrees with its .sha256 is refused', async () => {
  const tgz = (c) => ({ sha: c.repeat(64), recorded: c.repeat(64), name: NAME, version: VERSION });
  const two = [ladderArt(1, D('zip-one')), ladderArt(2, D('zip-two'))];
  const picked = await resolvePackage(ctx(), io({ artifacts: two, tarballs: { 1: tgz('a'), 2: tgz('b') } }));
  assert.equal(picked.inputs.artifact_id, '2');
  assert.equal(picked.inputs.certified, 'b'.repeat(64));
  const older = await resolvePackage(ctx(), io({ artifacts: two, tarballs: { 1: tgz('a'), 2: tgz('b') }, conclusions: { 102: 'failure' } }));
  assert.equal(older.inputs.artifact_id, '1');
  await assert.rejects(resolvePackage(ctx(), io({ artifacts: [two[0]], tarballs: { 1: { ...tgz('a'), recorded: 'c'.repeat(64) } } })), /package\.tgz\.sha256 says c+/);
});

test('ladder-merge-resolve: a zip that does not match its artifact digest is refused', async (t) => {
  assert.equal(zipDigestProblem({ id: 1, digest: D('zip') }, Buffer.from('zip')), '');
  assert.match(zipDigestProblem({ id: 1, digest: D('zip') }, Buffer.from('forged')), /downloaded as sha256:[0-9a-f]+, not its digest/);
  assert.match(zipDigestProblem({ id: 1 }, Buffer.from('zip')), /no sha256 digest/);
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.from('forged'), { status: 200 });
  t.after(() => (globalThis.fetch = real));
  const got = await githubIo({ repo: 'o/r', token: 'x' }).download({ id: 1, digest: D('zip') });
  assert.match(tarballProblem(got, { name: NAME, version: VERSION }), /not its digest/);
});

test('publish: a fetched tarball whose sha does not match the certified sha fails before npm publish', async (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'artifact-consumers-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'package'));
  writeFileSync(join(dir, 'package', 'package.json'), JSON.stringify({ name: NAME, version: VERSION }));
  const tgz = join(dir, 'package.tgz');
  execFileSync('bash', ['-c', `COPYFILE_DISABLE=1 tar -cf - -C "${dir}" package | gzip -n > "${tgz}"`]);
  const real = sha(readFileSync(tgz));
  const server = createServer((req, res) => {
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const go = (certified) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [join(scripts, 'gate.mjs'), 'certified-publish', '--', process.execPath, join(scripts, 'assert-certified-publish.mjs'), tgz, '--npm', NAME, '--certified', certified], { env: { ...process.env, HOMESCOOP_REGISTRY: url } });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (out += d));
      p.on('close', (code) => resolve({ code, out }));
    });
  const forged = await go('f'.repeat(64));
  assert.notEqual(forged.code, 0, forged.out);
  assert.match(forged.out, /certified-publish: FAIL/);
  const ok = await go(real);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /certified-publish: PASS/);
});

const BY_NAME_OK = new Map([
  ['ladder-build.yml name: host-${{ matrix.package }}-pr${{ github.event.pull_request.number }}', "the PR's own build, in its own run; the reviewers judge these bytes, and the publish takes them by id from a green run"],
  ['ladder-build.yml name: rebuild-${{ matrix.package }}-pr${{ github.event.pull_request.number }}', "the PR's own rebuild, in its own run"],
  ['ladder-build.yml pattern: host-@(${{ steps.plan.outputs.peers }})-pr${{ github.event.pull_request.number }}', "an extglob of exact peer names, all the PR's own builds"],
]);

test('every artifact download in the workflows is by id, or listed here with its reason', () => {
  const seen = [];
  for (const file of readdirSync(workflows).filter((f) => f.endsWith('.yml'))) {
    const lines = readFileSync(join(workflows, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      assert.doesNotMatch(line, /gh run download/, `${file}:${i + 1} downloads by name with gh run download`);
      assert.doesNotMatch(line, /merge-multiple:\s*true/, `${file}:${i + 1} merges artifacts into one directory`);
      if (!/uses:\s*actions\/download-artifact@/.test(line)) return;
      const indent = line.indexOf('uses:');
      const keys = [];
      for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || lines[j].search(/\S/) >= indent); j++) {
        const m = lines[j].match(/^\s*(name|pattern|artifact-ids):\s*(.+)$/);
        if (m) keys.push([m[1], m[2].trim()]);
      }
      const how = keys.find(([k]) => k === 'artifact-ids') ?? keys.find(([k]) => k === 'name' || k === 'pattern');
      assert.ok(how, `${file}:${i + 1}: download-artifact without artifact-ids, name or pattern downloads every artifact of the run`);
      if (how[0] === 'artifact-ids') return;
      const key = `${file} ${how[0]}: ${how[1]}`;
      seen.push(key);
      assert.ok(BY_NAME_OK.has(key), `${file}:${i + 1}: ${how[0]}: ${how[1]} is not by id; download by artifact-ids or list it in BY_NAME_OK with why it is safe`);
    });
  }
  for (const key of BY_NAME_OK.keys()) assert.ok(seen.includes(key), `BY_NAME_OK lists ${key}, which no workflow has any more; drop it`);
});
