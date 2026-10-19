import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALLOWLIST,
  check,
  closure,
  compare,
  kernelsOf,
  loadCheckout,
  makeSource,
  maxSatisfying,
  parseAllowlist,
  parseSpec,
  refresh,
  rootsOf,
  satisfies,
  verdictLines,
} from '../cert-kernel-floor.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASH = '@ai-ecoverse/wasm-bash';
const CORE = '@ai-ecoverse/wasm-coreutils';
const GIT = '@ai-ecoverse/wasm-git';
const PY = '@ai-ecoverse/wasix-python';
const NUMPY = '@ai-ecoverse/py-numpy';

// npm as it was for homescoop#1292: wasm-bash 5.3.0-21 (latest) needs >=1.130.2.
const snapshot = {
  packages: {
    [BASH]: { tags: { latest: '5.3.0-21' }, versions: { '5.3.0-19': { engines: '>=1.48.3' }, '5.3.0-20': { engines: '>=1.48.3' }, '5.3.0-21': { engines: '>=1.130.2' } } },
    [CORE]: { tags: { latest: '9.12.0-10' }, versions: { '9.12.0-9': { engines: '>=1.44.0' }, '9.12.0-10': { engines: '>=1.44.0' } } },
    [GIT]: { tags: { latest: '2.55.0-17' }, versions: { '2.55.0-17': { engines: '>=1.47.1', dependencies: { [BASH]: '5.3.0-19' } } } },
    [PY]: { tags: { latest: '3.14.2-29' }, versions: { '3.14.2-27': { engines: '>=1.100.0' }, '3.14.2-29': { engines: '>=1.122.3' } } },
    [NUMPY]: { tags: { latest: '2.3.2-10' }, versions: { '2.3.2-10': { dependencies: { [PY]: '>=3.14.2-16 <3.14.3' } } } },
  },
};
const recipe = (dir, npm, version, engines, extra = {}) => ({ dir, npm, version, tag: 'latest', retired: false, manifest: { name: npm, version, engines: engines ? { 'slicc-kernel': engines } : undefined, ...extra } });
const recipes = [recipe('bash', BASH, '5.3.0-21', '>=1.130.2'), recipe('coreutils', CORE, '9.12.0-10', '>=1.44.0')];
const checkout = (metas, over = {}) => ({ recipes, recipeDirs: new Map(recipes.map((r) => [r.dir, r])), metas, devPin: '1.132.1', snapshot, ...over });
const ALLOW = '# header\n';

test('semver: npm order and ranges, with a prerelease only matching a set that names its own x.y.z', () => {
  assert.equal(compare('5.3.0-21', '5.3.0-9'), 1);
  assert.equal(compare('1.130.2', '1.130.2-1'), 1);
  assert.equal(compare('2.9.0-post0.3', '2.9.0-post0.10'), -1);
  assert.equal(satisfies('1.128.0', '>=1.130.2'), false);
  assert.equal(satisfies('1.132.1', '>=1.130.2'), true);
  assert.equal(satisfies('3.14.2-29', '>=3.14.2-16 <3.14.3'), true);
  assert.equal(satisfies('3.15.0-1', '>=3.14.2-16 <3.14.3'), false);
  assert.equal(satisfies('1.5.0-1', '>=1.4.0'), false, 'a prerelease of another x.y.z');
  assert.equal(satisfies('1.9.0', '^1.4.0'), true);
  assert.equal(satisfies('2.0.0-1', '^1.4.0'), false);
  assert.equal(satisfies('0.3.1', '^0.2.0'), false);
  assert.equal(satisfies('1.4.9', '~1.4.2'), true);
  assert.equal(satisfies('1.0.0', '*'), true);
  assert.equal(satisfies('1.0.0', '<1.0.0 || >=1.0.0'), true);
  assert.equal(maxSatisfying(['3.14.2-27', '3.14.2-29', '3.15.0-1'], '>=3.14.2-16 <3.14.3'), '3.14.2-29');
  assert.equal(maxSatisfying(['1.0.0'], '>=2.0.0'), null);
});

test('parseSpec: a scoped name with a version, a tag, a range or nothing (npm latest)', () => {
  assert.deepEqual(parseSpec(BASH), { name: BASH, ref: 'latest' });
  assert.deepEqual(parseSpec(`${BASH}@5.3.0-19`), { name: BASH, ref: '5.3.0-19' });
  assert.deepEqual(parseSpec(`${PY}@python3.15`), { name: PY, ref: 'python3.15' });
  assert.deepEqual(parseSpec('left-pad@^1.3.0'), { name: 'left-pad', ref: '^1.3.0' });
  assert.throws(() => parseSpec(''), /not an npm spec/);
});

test('#1292: kernel 1.128.0 with wasm-bash unpinned is below the latest wasm-bash floor; pinned -20 or kernel 1.132.1 pass', () => {
  const bare = { kernel: '@ai-ecoverse/slicc-kernel@1.128.0', needs: [BASH, CORE] };
  const out = check(checkout([{ pkg: 'wasi-pnpm', meta: bare }]), ALLOW);
  assert.deepEqual(out.problems, [
    "packages/wasi-pnpm/cert/meta.json: kernel @ai-ecoverse/slicc-kernel@1.128.0 is below @ai-ecoverse/wasm-bash@5.3.0-21's engines.slicc-kernel >=1.130.2",
  ]);
  assert.match(verdictLines(out).at(-1), /^cert-kernel-floor: FAIL 1 problem\(s\) in 1 cert\/meta.json file\(s\)$/);
  const pinned = { ...bare, needsInstall: [`${BASH}@5.3.0-20`, CORE] };
  assert.deepEqual(check(checkout([{ pkg: 'wasi-pnpm', meta: pinned }]), ALLOW).problems, []);
  const moved = { ...bare, kernel: '@ai-ecoverse/slicc-kernel@1.132.1' };
  const ok = check(checkout([{ pkg: 'wasi-pnpm', meta: moved }]), ALLOW);
  assert.deepEqual(ok.problems, []);
  assert.match(verdictLines(ok).at(-1), /^cert-kernel-floor: PASS 1 cert\/meta.json file\(s\)/);
});

test('needsInstall wins over needs, as the harness installs `needsInstall || needs` (an empty needsInstall installs nothing)', () => {
  const meta = { kernel: '@ai-ecoverse/slicc-kernel@1.100.0', needs: [BASH], needsInstall: [] };
  assert.deepEqual(rootsOf(meta), []);
  assert.deepEqual(check(checkout([{ pkg: 'x', meta }]), ALLOW).problems, []);
});

test('a bare name also resolves to the recipe version here, so a PR that raises a floor fails before npm has it', () => {
  const raised = [recipe('bash', BASH, '5.3.0-22', '>=1.140.0'), recipes[1]];
  const meta = { kernel: '@ai-ecoverse/slicc-kernel@1.132.1', needs: [BASH] };
  const out = check(checkout([{ pkg: 'x', meta }], { recipes: raised, recipeDirs: new Map(raised.map((r) => [r.dir, r])) }), ALLOW);
  assert.deepEqual(out.problems, ["packages/x/cert/meta.json: kernel @ai-ecoverse/slicc-kernel@1.132.1 is below @ai-ecoverse/wasm-bash@5.3.0-22's engines.slicc-kernel >=1.140.0"]);
});

test('dependencies: the highest match, nested; or the root that satisfies the range, as npm hoists it', () => {
  const source = makeSource({ snapshot, recipes });
  const git = closure(source, rootsOf({ needs: [GIT, BASH] }));
  assert.deepEqual(git.map((p) => `${p.name}@${p.version}`), [`${GIT}@2.55.0-17`, `${BASH}@5.3.0-19`, `${BASH}@5.3.0-21`]);
  assert.deepEqual(git[1].via, [`${GIT}@2.55.0-17`, `${BASH}@5.3.0-19`]);
  const hoisted = closure(source, rootsOf({ needsInstall: [`${PY}@3.14.2-27`, `${NUMPY}@2.3.2-10`] }));
  assert.deepEqual(hoisted.map((p) => `${p.name}@${p.version}`), [`${PY}@3.14.2-27`, `${NUMPY}@2.3.2-10`]);
  const highest = closure(source, rootsOf({ needsInstall: [`${NUMPY}@2.3.2-10`] }));
  assert.deepEqual(highest.map((p) => `${p.name}@${p.version}`), [`${NUMPY}@2.3.2-10`, `${PY}@3.14.2-29`]);
  const msg = check(checkout([{ pkg: 'x', meta: { kernel: '@ai-ecoverse/slicc-kernel@1.110.0', needsInstall: [`${NUMPY}@2.3.2-10`] } }]), ALLOW).problems[0];
  assert.match(msg, /below @ai-ecoverse\/wasix-python@3\.14\.2-29's engines\.slicc-kernel >=1\.122\.3 \(via @ai-ecoverse\/py-numpy@2\.3\.2-10\)$/);
});

test('needsRepack resolves the peer at this checkout; a pin or a name the snapshot lacks fails with the refresh command', () => {
  const recipeDirs = new Map(recipes.map((r) => [r.dir, r]));
  assert.deepEqual(rootsOf({ needsRepack: ['bash'] }, recipeDirs), [{ name: BASH, ref: '5.3.0-21', via: ['needsRepack bash'] }]);
  assert.throws(() => rootsOf({ needsRepack: ['nope'] }, recipeDirs), /needsRepack nope: no packages\/nope\/package\/package.json version/);
  const unknownPin = check(checkout([{ pkg: 'x', meta: { needsInstall: [`${BASH}@5.3.0-99`] } }]), ALLOW).problems;
  assert.match(unknownPin.join(), /wasm-bash@5\.3\.0-99 is not in scripts\/cert-kernel-floor-snapshot\.json: run node scripts\/cert-kernel-floor\.mjs --refresh/);
  const unknownName = check(checkout([{ pkg: 'x', meta: { needs: ['@ai-ecoverse/wasm-nope'] } }]), ALLOW).problems;
  assert.match(unknownName.join(), /wasm-nope is not in scripts\/cert-kernel-floor-snapshot\.json: run node scripts\/cert-kernel-floor\.mjs --refresh/);
});

test('kernelsOf: cert/meta.json kernel, else the dev-pin; extra_kernels objects with specs; notes and ci-only entries are not checked', () => {
  assert.deepEqual(kernelsOf({}, '1.132.1'), [{ version: '1.132.1', why: 'kernel (the package.json dev-pin; cert/meta.json names none)' }]);
  const meta = {
    kernel: '@ai-ecoverse/slicc-kernel@1.132.1',
    extra_kernels: ['@ai-ecoverse/slicc-kernel@1.88.0 (a note)', { kernel: '@ai-ecoverse/slicc-kernel@1.122.0', why: 'w', specs: true }, { kernel: '@ai-ecoverse/slicc-kernel@1.102.2', why: 'w', ci: ['x'] }],
  };
  assert.deepEqual(kernelsOf(meta, '1.132.1'), [{ version: '1.132.1', why: 'kernel' }, { version: '1.122.0', why: 'extra_kernels' }]);
  assert.throws(() => kernelsOf({ kernel: '@ai-ecoverse/slicc-kernel@latest' }, '1.132.1'), /not an exact @ai-ecoverse\/slicc-kernel@<version>/);
  const out = check(checkout([{ pkg: 'x', meta: { ...meta, needs: [BASH] } }]), ALLOW).problems;
  assert.deepEqual(out, ["packages/x/cert/meta.json: extra_kernels @ai-ecoverse/slicc-kernel@1.122.0 is below @ai-ecoverse/wasm-bash@5.3.0-21's engines.slicc-kernel >=1.130.2"]);
});

test('the allowlist: a listed violation passes and is printed; a line that no longer violates, names no cert, or is malformed fails', () => {
  const low = { kernel: '@ai-ecoverse/slicc-kernel@1.47.1', needs: [BASH] };
  const high = { kernel: '@ai-ecoverse/slicc-kernel@1.132.1', needs: [BASH] };
  const line = `git #1292 ${BASH} kernel 1.47.1\n`;
  const listed = check(checkout([{ pkg: 'git', meta: low }]), line);
  assert.deepEqual(listed.problems, []);
  const lines = verdictLines(listed);
  assert.match(lines[0], /^cert-kernel-floor: allowlisted git \(#1292\): packages\/git\/cert\/meta.json: kernel @ai-ecoverse\/slicc-kernel@1\.47\.1 is below/);
  assert.equal(lines.at(-1), "cert-kernel-floor: PASS 1 cert/meta.json file(s): every cert kernel satisfies its needs' engines.slicc-kernel, 1 allowlisted");
  assert.match(check(checkout([{ pkg: 'git', meta: high }]), line).problems.join(), /lists git \(#1292\), but its cert kernel satisfies every need's engines\.slicc-kernel: drop the line/);
  assert.match(check(checkout([]), `gone #1292 ${BASH} why\n`).problems.join(), /lists gone, which has no packages\/gone\/cert\/meta.json \(or is retired\): drop the line/);
  assert.match(parseAllowlist('git #1292 because\n').problems.join(), /"git #1292 because" is not "<recipe> #<issue> <npm name>\[,<npm name>…\] <reason>"/);
  assert.match(parseAllowlist(`git #1 ${BASH} a\ngit #1 ${BASH} b\n`).problems.join(), /git is listed twice/);
  assert.deepEqual(parseAllowlist(`git #1292 ${BASH},${CORE} why\n`).entries.get('git').needs, [BASH, CORE]);
});

test('the allowlist exempts only the needs it names: a second need above an allowlisted cert kernel fails; a named need that passes is stale', () => {
  const raised = [recipes[0], recipe('coreutils', CORE, '9.12.0-11', '>=1.130.0')];
  const over = { recipes: raised, recipeDirs: new Map(raised.map((r) => [r.dir, r])) };
  const meta = { kernel: '@ai-ecoverse/slicc-kernel@1.47.1', needs: [BASH, CORE] };
  const out = check(checkout([{ pkg: 'git', meta }], over), `git #1292 ${BASH} kernel 1.47.1\n`);
  assert.deepEqual(out.problems, ["packages/git/cert/meta.json: kernel @ai-ecoverse/slicc-kernel@1.47.1 is below @ai-ecoverse/wasm-coreutils@9.12.0-11's engines.slicc-kernel >=1.130.0"]);
  assert.deepEqual(check(checkout([{ pkg: 'git', meta }], over), `git #1292 ${BASH},${CORE} both\n`).problems, []);
  const stale = check(checkout([{ pkg: 'git', meta }]), `git #1292 ${BASH},${CORE} both\n`).problems;
  assert.deepEqual(stale, [`scripts/cert-kernel-floor-allowlist.txt lists ${CORE} for git (#1292), but its cert kernel satisfies its engines.slicc-kernel: drop it from the line`]);
});

test('--refresh: fetches each name the closures reach once, keeps engines, dependencies and dist-tags', async () => {
  const docs = {
    [GIT]: { 'dist-tags': { latest: '2.55.0-17' }, versions: { '2.55.0-17': { engines: { 'slicc-kernel': '>=1.47.1', node: '>=20' }, dependencies: { [BASH]: '5.3.0-19' }, description: 'dropped' } } },
    [BASH]: { 'dist-tags': { latest: '5.3.0-21' }, versions: { '5.3.0-21': { engines: { 'slicc-kernel': '>=1.130.2' } }, '5.3.0-19': {} } },
  };
  const asked = [];
  const fetchDoc = async (n) => (asked.push(n), docs[n] ?? null);
  const snap = await refresh({ recipes: [], recipeDirs: new Map(), metas: [{ pkg: 'x', meta: { needs: [GIT] } }, { pkg: 'y', meta: { needs: [GIT] } }] }, fetchDoc);
  assert.deepEqual(asked.sort(), [BASH, GIT]);
  assert.deepEqual(snap.packages[GIT], { tags: { latest: '2.55.0-17' }, versions: { '2.55.0-17': { engines: '>=1.47.1', dependencies: { [BASH]: '5.3.0-19' } } } });
  assert.deepEqual(Object.keys(snap.packages[BASH].versions), ['5.3.0-19', '5.3.0-21']);
});

test('every cert kernel here satisfies the engines.slicc-kernel of what its cert installs, or is allowlisted', () => {
  const allow = readFileSync(join(root, ALLOWLIST), 'utf8');
  const lines = verdictLines(check(loadCheckout(root), allow));
  for (const l of lines) console.log(l);
  assert.match(lines.at(-1), /^cert-kernel-floor: PASS /, lines.filter((l) => l.includes(': FAIL ')).join('\n'));
});
