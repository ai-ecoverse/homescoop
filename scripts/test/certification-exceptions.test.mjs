import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit, checkOnline, covers, FILE, inRange, knownInputsMissing, parseRange, pinLine, readLockfile, validate } from '../certification-exceptions.mjs';
import { fixtureRegistry, KNOWN_INPUTS } from '../cert-review/repack-input.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(root, 'scripts', 'certification-exceptions.mjs');
const I = (n) => `https://github.com/ai-ecoverse/homescoop/issues/${n}`;
const S = '@ai-ecoverse/';

const entry = (over = {}) => ({ package: S + 'py-pandas', range: '>=2.3.2-5 <=2.3.2-11', verdict: 'fail', issue: I(730), ruling: 'cert lane 2026-10-17 03:45: unverifiable build', ...over });
const doc = (...entries) => ({ schema: 1, entries });

test('the committed file is schema-valid and has a fail entry for every known-inputs.txt line (#864)', () => {
  const real = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.deepEqual(validate(real), []);
  assert.deepEqual(knownInputsMissing(real, readFileSync(KNOWN_INPUTS, 'utf8')), []);
  const bash = real.entries.find((e) => e.package === S + 'wasm-bash');
  assert.deepEqual(bash.requires, { [S + 'slicc-kernel']: '>=1.130.2' }, 'the #1230 condition');
});

test('ranges read like node-semver with includePrerelease, and only the comparator subset parses', () => {
  const r = '>=2.3.2-5 <=2.3.2-11';
  for (const v of ['2.3.2-5', '2.3.2-9', '2.3.2-10', '2.3.2-11']) assert.equal(inRange(v, r), true, v);
  for (const v of ['2.3.2-4', '2.3.2-12', '2.3.2', '2.3.3-1', '2.3.1']) assert.equal(inRange(v, r), false, v);
  assert.equal(inRange('1.2.0', '<1.0.0 || >=1.2.0'), true);
  assert.equal(inRange('1.1.0', '<1.0.0 || >=1.2.0'), false);
  assert.equal(inRange('1.130.2', '>=1.130.2'), true);
  assert.equal(inRange('1.129.0', '>=1.130.2'), false);
  for (const bad of ['^1.2.3', '~1.2.3', '1.2.x', '1.2', '1.2.3 - 1.4.0', '>= 1.2.3', '*', '', 'v1.2.3']) assert.throws(() => parseRange(bad), bad);
  assert.equal(covers({ versions: ['0.12.1-7'] }, '0.12.1-7'), true);
  assert.equal(covers({ versions: ['0.12.1-7'] }, '0.12.1-9'), false);
});

test('validate fails closed on every shape the gate would refuse', () => {
  assert.deepEqual(validate(doc(entry())), []);
  assert.deepEqual(validate(doc()), []);
  const cases = [
    [{ schema: 2, entries: [] }, /schema is 2/],
    [{ schema: 1, entries: [], accept: [] }, /unknown top-level key "accept"/],
    [{ schema: 1 }, /entries is not an array/],
    [doc(entry({ note: 'x' })), /unknown key "note"/],
    [doc(entry({ versions: ['2.3.2-5'] })), /exactly one of versions or range/],
    [doc((({ range, ...e }) => e)(entry())), /exactly one of versions or range/],
    [doc(entry({ range: undefined, versions: [] })), /exactly one|non-empty/],
    [doc((({ range, ...e }) => ({ ...e, versions: ['2.3.2-5', '2.3.2-5'] }))(entry())), /listed twice/],
    [doc((({ range, ...e }) => ({ ...e, versions: ['latest'] }))(entry())), /not an exact version/],
    [doc(entry({ range: '^2.3.2' })), /range: .*only =/],
    [doc(entry({ verdict: 'accept' })), /verdict "accept"/],
    [doc(entry({ verdict: 'requires' })), /needs requires/],
    [doc(entry({ verdict: 'requires', requires: { [S + 'slicc-kernel']: '~1.130' } })), /requires @ai-ecoverse\/slicc-kernel: /],
    [doc(entry({ requires: { [S + 'slicc-kernel']: '>=1.130.2' } })), /requires is only for verdict "requires"/],
    [doc(entry({ package: 'py-pandas' })), /package must be/],
    [doc(entry({ issue: 'https://github.com/ai-ecoverse/homescoop/pull/730' })), /issue must be/],
    [doc(entry({ issue: undefined })), /issue must be/],
    [doc(entry({ ruling: 'two\nlines' })), /ruling must be one/],
    [doc(entry({ ruling: '' })), /ruling must be one/],
    [doc((({ range, ...e }) => ({ ...e, versions: ['2.3.2-6'] }))(entry()), entry()), /range .* also covers @ai-ecoverse\/py-pandas@2.3.2-6/],
  ];
  for (const [d, re] of cases) {
    const errors = validate(JSON.parse(JSON.stringify(d)));
    assert.ok(errors.some((e) => re.test(e)), `${re}: ${JSON.stringify(errors)}`);
  }
  const twice = { package: S + 'wasm-git', versions: ['2.55.0-14'], verdict: 'fail', issue: I(858), ruling: 'r' };
  assert.ok(validate(doc(twice, { ...twice })).some((e) => /also in entry 0/.test(e)));
});

test('a known-inputs.txt line without a fail entry is reported', () => {
  const known = '@ai-ecoverse/wasm-zlib@1.3.1-2 #864 no provenance\n@ai-ecoverse/py-pandas@2.3.2-6 #730 x\n';
  assert.deepEqual(knownInputsMissing(doc(entry()), known), ['@ai-ecoverse/wasm-zlib@1.3.1-2 (#864) is in known-inputs.txt but has no fail entry']);
});

// ---- npm fixtures: packuments and SLSA attestations, written to a temp dir ----

const integrityOf = (s) => `sha512-${createHash('sha512').update(s).digest('base64')}`;
const enc = (n) => n.replace('/', '%2f');

function statement(name, version, integrity, { ref = 'refs/heads/main', path = '.github/workflows/ladder-build.yml', repo = 'https://github.com/ai-ecoverse/homescoop', runner = 'github-hosted' } = {}) {
  return {
    subject: [{ name: `pkg:npm/${name.replace(/^@/, '%40')}@${version}`, digest: { sha512: Buffer.from(integrity.slice(7), 'base64').toString('hex') } }],
    predicate: {
      buildDefinition: {
        externalParameters: { workflow: { repository: repo, path, ref } },
        resolvedDependencies: [{ uri: `git+${repo}@${ref}`, digest: { gitCommit: 'a'.repeat(40) } }],
      },
      runDetails: { builder: { id: `https://github.com/actions/runner/${runner}` }, metadata: { invocationId: 'run' } },
    },
  };
}

/** packages: { name: { version: { prov?: options | false, deprecated? } } } */
function fixtures(packages, issues = []) {
  const dir = mkdtempSync(join(tmpdir(), 'cert-exceptions-'));
  mkdirSync(join(dir, 'packument'));
  mkdirSync(join(dir, 'attestations'));
  const integrity = {};
  for (const [name, versions] of Object.entries(packages)) {
    const pack = { name, versions: {} };
    for (const [v, opt] of Object.entries(versions)) {
      const i = integrityOf(`${name}@${v}`);
      integrity[`${name}@${v}`] = i;
      pack.versions[v] = { version: v, dist: { integrity: i }, ...(opt.deprecated ? { deprecated: opt.deprecated } : {}) };
      if (opt.prov !== false) {
        const st = statement(name, v, i, opt.prov || {});
        const att = { attestations: [{ predicateType: 'https://slsa.dev/provenance/v1', bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(st)).toString('base64') } } }] };
        writeFileSync(join(dir, 'attestations', `${enc(name)}@${v}.json`), JSON.stringify(att));
      }
    }
    writeFileSync(join(dir, 'packument', `${enc(name)}.json`), JSON.stringify(pack));
  }
  writeFileSync(join(dir, 'issues.json'), JSON.stringify(issues));
  return { dir, integrity };
}

const ISSUES = [I(730), I(858), I(1230)];
const NPM = {
  [S + 'py-pandas']: { '2.3.2-11': {}, '2.3.2-12': {}, '3.0.6-1': {} },
  [S + 'py-cycler']: { '0.12.1-7': {}, '0.12.1-9': {} },
  [S + 'wasm-bash']: { '5.3.0-19': {}, '5.3.0-20': {} },
  [S + 'wasm-git']: { '2.55.0-15': { prov: false }, '2.55.0-17': { prov: { runner: 'self-hosted' } } },
  [S + 'wasm-sed']: { '4.10.0-4': { prov: { ref: 'refs/heads/bb/feature' } } },
  [S + 'wasm-tar']: { '1.35.0-8': { prov: { path: '.github/workflows/ladder-pr.yml' } } },
  [S + 'wasi-pnpm']: { '12.9.1-11': { deprecated: 'use 12.9.1-15: rayon worker trap' } },
  [S + 'wasm-jq']: { '1.8.2-4': {} },
  [S + 'slicc-kernel']: { '1.129.0': { prov: false }, '1.132.1': { prov: false } },
  [S + 'wasm-xxd']: { '9.2.1192-3': { prov: { runner: 'some-other-builder' } } },
  [S + 'wasm-retired']: { '1.0.0-2': { prov: false } },
  [S + 'wasm-renamed']: { '2.0.0-1': {} },
  [S + 'slicc-cdp']: { '1.30.11': { prov: { repo: 'https://github.com/ai-ecoverse/slicc-cdp', path: '.github/workflows/release.yml' } } },
};
const RULES = doc(
  entry(),
  { package: S + 'py-cycler', versions: ['0.12.1-7'], verdict: 'fail', issue: I(858), ruling: 'cert lane 2026-10-17 04:40: a repack of an unverifiable root' },
  { package: S + 'wasm-bash', versions: ['5.3.0-20'], verdict: 'requires', requires: { [S + 'slicc-kernel']: '>=1.130.2' }, issue: I(1230), ruling: 'FAIL below slicc-kernel 1.130.2' },
  { package: S + 'wasm-git', versions: ['2.55.0-15'], verdict: 'fail', issue: I(858), ruling: 'no provenance' },
  { package: S + 'wasm-retired', versions: ['1.0.0-2'], verdict: 'fail', issue: I(858), ruling: 'a package no longer under packages/' },
);
// Today's packages/: wasm-retired and wasm-renamed have left it, slicc-* were never in it.
const NAMES = new Set(Object.keys(NPM).filter((n) => ![S + 'slicc-kernel', S + 'slicc-cdp', S + 'wasm-retired', S + 'wasm-renamed'].includes(n)));

test('checkOnline: an unknown package, version, range or issue is a typo', async () => {
  const { dir } = fixtures(NPM, ISSUES);
  try {
    const registry = fixtureRegistry(dir);
    const issueExists = async (u) => ISSUES.includes(u);
    assert.deepEqual(await checkOnline(RULES, { registry, issueExists }), []);
    const bad = doc(
      entry({ range: '>=2.3.2-1 <=2.3.2-4' }),
      { package: S + 'py-cycler', versions: ['0.12.1-8'], verdict: 'fail', issue: I(858), ruling: 'r' },
      { package: S + 'no-such', versions: ['1.0.0'], verdict: 'fail', issue: I(858), ruling: 'r' },
      { package: S + 'wasm-jq', versions: ['1.8.2-4'], verdict: 'fail', issue: I(99999), ruling: 'r' },
      { package: S + 'wasm-bash', versions: ['5.3.0-20'], verdict: 'requires', requires: { [S + 'no-kernel']: '>=1.0.0' }, issue: I(1230), ruling: 'r' },
    );
    const errors = await checkOnline(bad, { registry, issueExists });
    for (const re of [/matches no published version of @ai-ecoverse\/py-pandas/, /py-cycler@0.12.1-8 isn't on npm/, /no-such isn't on npm/, /issues\/99999 doesn't exist/, /requires @ai-ecoverse\/no-kernel, which isn't on npm/]) {
      assert.ok(errors.some((e) => re.test(e)), `${re}: ${JSON.stringify(errors)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function lockfiles(integrity, { kernel = '1.132.1', pins }) {
  const pkgLock = { name: 'bios', lockfileVersion: 3, packages: { '': { name: 'bios' } } };
  const pnpm = ["lockfileVersion: '9.0'", '', 'importers:', '', '  .:', '    dependencies:', '', 'packages:', ''];
  pins.forEach(([name, v, where = 'npm', over], i) => {
    const integ = over === undefined ? integrity[`${name}@${v}`] || integrityOf('x') : over;
    if (where === 'npm') pkgLock.packages[`node_modules/${name}`] = { version: v, resolved: `https://registry.npmjs.org/${name}/-/x-${v}.tgz`, ...(integ ? { integrity: integ } : {}) };
    else pnpm.push(`  '${name}@${v}':`, `    resolution: {integrity: ${integ}}`, '');
    if (i === 0) pkgLock.packages['node_modules/@ai-ecoverse/slicc-kernel'] = { version: kernel, integrity: integrity[`${S}slicc-kernel@${kernel}`] };
  });
  pkgLock.packages['node_modules/left-pad'] = { version: '1.3.0', integrity: integrityOf('left-pad') };
  pnpm.push('snapshots:', '', `  '${S}py-pandas@3.0.6-1': {}`, '');
  return { pkgLock: JSON.stringify(pkgLock, null, 2), pnpm: pnpm.join('\n') };
}

test('readLockfile reads package-lock.json v3 and pnpm-lock.yaml v9 pins', () => {
  const { pkgLock, pnpm } = lockfiles({}, { pins: [[S + 'wasm-jq', '1.8.2-4'], [S + 'py-pandas', '3.0.6-1', 'pnpm', 'sha512-abc==']] });
  const a = readLockfile(pkgLock, 'package-lock.json');
  assert.deepEqual(a.map((p) => `${p.name}@${p.version}`), [`${S}wasm-jq@1.8.2-4`, `${S}slicc-kernel@1.132.1`, 'left-pad@1.3.0']);
  const b = readLockfile(pnpm, 'pnpm-lock.yaml');
  assert.deepEqual(b, [{ name: S + 'py-pandas', version: '3.0.6-1', integrity: 'sha512-abc==', file: 'pnpm-lock.yaml' }]);
  assert.throws(() => readLockfile("lockfileVersion: '6.0'\n"), /pnpm-lock.yaml v9/);
});

test('audit: one verdict per homescoop pin; DENY from the file, FAIL without main provenance, deprecated or mismatched', async () => {
  const { dir, integrity } = fixtures(NPM, ISSUES);
  try {
    const registry = fixtureRegistry(dir);
    const run = async (kernel, pins) => {
      const { pkgLock, pnpm } = lockfiles(integrity, { kernel, pins });
      const all = [...readLockfile(pkgLock, 'package-lock.json'), ...readLockfile(pnpm, 'pnpm-lock.yaml')];
      return Object.fromEntries((await audit({ doc: RULES, pins: all, names: NAMES, registry })).map((r) => [`${r.name}@${r.version}`, r]));
    };
    const rows = await run('1.132.1', [
      [S + 'py-pandas', '3.0.6-1', 'pnpm'],
      [S + 'py-pandas', '2.3.2-11'],
      [S + 'py-cycler', '0.12.1-7', 'pnpm'],
      [S + 'py-cycler', '0.12.1-9', 'pnpm'],
      [S + 'wasm-bash', '5.3.0-20'],
      [S + 'wasm-git', '2.55.0-15', 'pnpm'],
      [S + 'wasm-git', '2.55.0-17'],
      [S + 'wasm-sed', '4.10.0-4'],
      [S + 'wasm-tar', '1.35.0-8'],
      [S + 'wasi-pnpm', '12.9.1-11'],
      [S + 'wasm-jq', '1.8.2-4', 'npm', integrityOf('tampered')],
      [S + 'wasm-xxd', '9.2.1192-3'],
      [S + 'wasm-retired', '1.0.0-2'],
      [S + 'wasm-renamed', '2.0.0-1'],
      [S + 'slicc-cdp', '1.30.11'],
    ]);
    const v = (k) => rows[S + k]?.verdict;
    assert.equal(v('py-pandas@3.0.6-1'), 'PASS');
    assert.match(rows[S + 'py-pandas@3.0.6-1'].why, /^ladder-build@main a{10}, hosted$/);
    assert.equal(v('py-pandas@2.3.2-11'), 'DENY', 'a range entry with main provenance');
    assert.match(rows[S + 'py-pandas@2.3.2-11'].why, /issues\/730: cert lane/);
    assert.equal(v('py-cycler@0.12.1-7'), 'DENY');
    assert.equal(v('py-cycler@0.12.1-9'), 'PASS', 'a later CI build is outside the entry');
    assert.equal(v('wasm-bash@5.3.0-20'), 'PASS', 'kernel 1.132.1 satisfies >=1.130.2');
    assert.match(rows[S + 'wasm-bash@5.3.0-20'].why, /requires @ai-ecoverse\/slicc-kernel >=1.130.2: bios pins 1.132.1/);
    assert.equal(v('wasm-git@2.55.0-15'), 'DENY');
    assert.match(rows[S + 'wasm-git@2.55.0-15'].why, /also no ladder-build@main provenance/);
    assert.equal(v('wasm-git@2.55.0-17'), 'PASS');
    assert.match(rows[S + 'wasm-git@2.55.0-17'].why, /pool$/, 'a self-hosted pool runner is accepted and named');
    assert.equal(v('wasm-sed@4.10.0-4'), 'FAIL');
    assert.match(rows[S + 'wasm-sed@4.10.0-4'].why, /refs\/heads\/bb\/feature, not refs\/heads\/main/);
    assert.equal(v('wasm-tar@1.35.0-8'), 'FAIL');
    assert.match(rows[S + 'wasm-tar@1.35.0-8'].why, /ladder-pr.yml/);
    assert.equal(v('wasi-pnpm@12.9.1-11'), 'FAIL');
    assert.match(rows[S + 'wasi-pnpm@12.9.1-11'].why, /^npm-deprecated: use 12.9.1-15/);
    assert.equal(v('wasm-jq@1.8.2-4'), 'FAIL');
    assert.match(rows[S + 'wasm-jq@1.8.2-4'].why, /lockfile integrity .* isn't npm's/);
    assert.equal(v('wasm-xxd@9.2.1192-3'), 'FAIL', 'main provenance from neither a hosted nor a pool runner');
    assert.match(rows[S + 'wasm-xxd@9.2.1192-3'].why, /^provenance from builder https:\/\/github.com\/actions\/runner\/some-other-builder, not a hosted or pool runner$/);
    assert.equal(v('wasm-retired@1.0.0-2'), 'DENY', 'an entry outlives its package dir');
    assert.equal(v('wasm-renamed@2.0.0-1'), 'PASS', 'a pin whose provenance names homescoop counts without a package dir');
    assert.equal(rows[S + 'slicc-cdp@1.30.11'], undefined, "another repo's package gets no line");
    assert.equal(rows['left-pad@1.3.0'], undefined, 'only homescoop pins get a line');
    assert.equal(rows[S + 'slicc-kernel@1.132.1'], undefined);
    assert.equal(pinLine(rows[S + 'wasm-sed@4.10.0-4']).startsWith(`pin: FAIL ${S}wasm-sed@4.10.0-4 (`), true);

    const old = await run('1.129.0', [[S + 'wasm-bash', '5.3.0-20'], [S + 'wasm-bash', '5.3.0-19', 'pnpm']]);
    assert.equal(old[S + 'wasm-bash@5.3.0-20'].verdict, 'DENY', 'kernel 1.129.0 is below the #1230 floor');
    assert.match(old[S + 'wasm-bash@5.3.0-20'].why, /bios pins 1.129.0 \(https:\/\/github.com\/ai-ecoverse\/homescoop\/issues\/1230\)/);
    assert.equal(old[S + 'wasm-bash@5.3.0-19'].verdict, 'PASS');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: the verdict line is always last, and any non-PASS pin fails the run', () => {
  const { dir, integrity } = fixtures(NPM, ISSUES);
  try {
    const file = join(dir, 'exceptions.json');
    writeFileSync(file, JSON.stringify(RULES));
    const known = join(dir, 'known.txt');
    writeFileSync(known, '');
    const cli = (...args) => spawnSync(process.execPath, [SCRIPT, '--file', file, '--known', known, '--fixtures', dir, ...args], { encoding: 'utf8', cwd: root });
    const last = (r) => r.stdout.trim().split('\n').at(-1);

    const ok = cli('--check');
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(last(ok), /^certification-exceptions: PASS exceptions.json: 5 entries valid, every package, version and issue exists$/);

    const write = (name, pins) => {
      const { pkgLock } = lockfiles(integrity, { pins });
      writeFileSync(join(dir, name), pkgLock);
      return join(dir, name);
    };
    const good = cli('--audit', write('good.json', [[S + 'py-pandas', '3.0.6-1'], [S + 'wasm-bash', '5.3.0-20']]));
    assert.equal(good.status, 0, good.stdout);
    assert.deepEqual(good.stdout.trim().split('\n').filter((l) => l.startsWith('pin: ')).length, 2);
    assert.match(last(good), /PASS .*; 2 homescoop pins: 2 PASS, 0 DENY, 0 FAIL$/);

    const bad = cli('--audit', write('bad.json', [[S + 'py-pandas', '2.3.2-11'], [S + 'wasm-sed', '4.10.0-4'], [S + 'wasm-jq', '1.8.2-4']]));
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /^pin: DENY @ai-ecoverse\/py-pandas@2.3.2-11 \(/m);
    assert.match(bad.stdout, /^pin: FAIL @ai-ecoverse\/wasm-sed@4.10.0-4 \(/m);
    assert.match(bad.stdout, /^pin: PASS @ai-ecoverse\/wasm-jq@1.8.2-4 \(/m);
    assert.match(last(bad), /^certification-exceptions: FAIL .*3 homescoop pins: 1 PASS, 1 DENY, 1 FAIL$/);

    const none = cli('--audit', write('none.json', []));
    assert.equal(none.status, 1);
    assert.match(last(none), /FAIL .*no homescoop pins/);

    writeFileSync(file, JSON.stringify({ ...RULES, accept: [] }));
    const invalid = cli();
    assert.equal(invalid.status, 1);
    assert.match(invalid.stdout, /error: unknown top-level key "accept"/);
    assert.match(last(invalid), /^certification-exceptions: FAIL exceptions.json: 1 problem$/);

    writeFileSync(file, '{');
    assert.match(last(cli()), /^certification-exceptions: FAIL .* can't be read as JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
