import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { channelProblems, parseAllowlist, pickRecipe, recipeOf, recipeTag, tagProblem } from '../npm-tag.mjs';
import { classify, npmParity } from '../npm-parity.mjs';
import { classify as cleanup } from '../list-semver-cleanup.mjs';
import { certFor, siblingVersions } from '../ladder-merge-resolve.mjs';
import { peerTarball } from '../peer-tarball.mjs';
import { renderTable } from '../readme-table.mjs';
import { sameChannel } from '../cert-review/repack-input.mjs';
import { areaOf } from '../issue-labels.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NAME = '@ai-ecoverse/wasix-python';

function fixture(t, dirs, allow = '') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'npm-tag-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [dir, { npm = NAME, tag, version, upstream = '3.14.2', builder = 'host' }] of Object.entries(dirs)) {
    mkdirSync(join(root, 'packages', dir, 'package'), { recursive: true });
    writeFileSync(join(root, 'packages', dir, 'recipe.yaml'), `name: ${dir}\nbuilder: ${builder}\nversion: "${upstream}"\nnpm: "${npm}"\n${tag ? `npm-tag: "${tag}"\n` : ''}`);
    writeFileSync(join(root, 'packages', dir, 'package', 'package.json'), JSON.stringify({ name: npm, version, description: `${dir} recipe` }));
  }
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'npm-tag-allowlist.txt'), allow);
  writeFileSync(join(root, 'README.md'), 'x\n');
  return root;
}

const WAVE = {
  'wasix-python': { version: '3.14.2-28' },
  'wasix-python3.15': { tag: 'python3.15', version: '3.15.0-1', upstream: '3.15.0' },
};
const ALLOW = `# wave\n${NAME} #1138 Python 3.15 wave\n`;

test('1: npm-tag takes python<major>.<minor> only; latest, certified and next are reserved; no npm-tag is latest', () => {
  assert.equal(tagProblem('python3.15'), '');
  assert.equal(tagProblem('python3.9'), '');
  for (const bad of ['latest', 'certified', 'next', 'python3', 'py3.15', 'python3.15.1', '', 'Python3.15']) assert.notEqual(tagProblem(bad), '', bad);
  assert.equal(recipeTag('name: x\nnpm: "@ai-ecoverse/x"\n'), 'latest');
  assert.equal(recipeTag('name: x\nnpm-tag: "python3.15"  # the 3.15 wave\n'), 'python3.15');
  assert.equal(recipeTag('name: x\nsources:\n  npm-tag: next\n'), 'latest');
  assert.throws(() => recipeTag('npm-tag: latest\n'), /reserved/);
  assert.throws(() => recipeTag('npm-tag: next\n'), /reserved/);
  assert.throws(() => recipeTag('npm-tag: "3.15"\n'), /doesn't match/);
});

test('1: the CLI prints a recipe dir\'s tag, and fails on a bad one', (t) => {
  const root = fixture(t, { ...WAVE, bad: { npm: '@ai-ecoverse/bad', tag: 'next', version: '1.0.0-1' } }, ALLOW);
  const cli = (...a) => execFileSync(process.execPath, [join(repo, 'scripts/npm-tag.mjs'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  assert.equal(cli('wasix-python3.15', '--root', root), 'python3.15');
  assert.equal(cli('wasix-python', '--root', root), 'latest');
  assert.throws(() => cli('bad', '--root', root), /reserved/);
  assert.equal(cli('--check', 'python3.15'), '');
  assert.throws(() => cli('--check', 'latest'));
});

const reg = { versions: ['3.14.2-27', '3.14.2-28', '3.15.0-1'], latest: '3.14.2-28', tags: { latest: '3.14.2-28', 'python3.15': '3.15.0-1' } };

test('2: the behind-guard compares a tagged recipe with its own tag, an untagged one with latest only', () => {
  assert.equal(classify('3.15.0-2', reg, 'python3.15').kind, 'new');
  assert.deepEqual(classify('3.15.0-0', reg, 'python3.15'), { kind: 'behind', latest: '3.15.0-1', published: false });
  assert.equal(classify('3.15.0-1', { ...reg, tags: { latest: '3.14.2-28' } }, 'python3.15').kind, 'published');
  const first = classify('3.15.0-1', { versions: ['3.14.2-28'], latest: '3.14.2-28', tags: { latest: '3.14.2-28' } }, 'python3.15');
  assert.equal(first.kind, 'new');
  assert.match(first.why, /npm has no python3\.15/);
  assert.equal(classify('3.13.9-1', { ...reg, tags: { ...reg.tags, 'python3.13': '3.13.9-0' } }, 'python3.13').kind, 'new');
  assert.equal(classify('3.14.2-29', reg).kind, 'new');
  assert.equal(classify('3.14.2-29', reg, 'latest').kind, 'new');
});

test('2 NEGATIVE: an untagged recipe below latest is behind whatever the other tags hold; a tagged one below its tag is behind', () => {
  assert.equal(classify('3.14.2-27', reg).kind, 'behind');
  assert.equal(classify('3.14.2-27', { ...reg, tags: { ...reg.tags, 'python3.15': '3.14.2-1' } }).kind, 'behind');
  assert.equal(classify('3.15.0-0', reg, 'python3.15').kind, 'behind');
});

function tarball(t, version, readme = 'python\n') {
  const src = mkdtempSync(join(tmpdir(), 'npm-tag-tgz-'));
  t.after(() => rmSync(src, { recursive: true, force: true }));
  mkdirSync(join(src, 'package'));
  writeFileSync(join(src, 'package', 'package.json'), JSON.stringify({ name: NAME, version }));
  writeFileSync(join(src, 'package', 'README.md'), readme);
  return execFileSync('bash', ['-c', `COPYFILE_DISABLE=1 tar -cf - -C "${src}" package | gzip -n`]);
}

test('2: a version already on npm with other bytes is drift whatever the tag; a tag on a name without latest is refused', (t) => {
  const pack = () => tarball(t, '3.15.0-1', 'other\n');
  for (const tag of ['latest', 'python3.15']) {
    const r = npmParity(tarball(t, '3.15.0-1'), { drift: 'fail', tag, registry: () => ({ ...reg, latest: tag === 'latest' ? '3.15.0-1' : reg.latest }), pack });
    assert.equal(r.verdict, 'drift', tag);
    assert.equal(r.level, 'error', tag);
  }
  const same = npmParity(tarball(t, '3.15.0-1'), { drift: 'fail', tag: 'python3.15', registry: () => reg, pack: () => tarball(t, '3.15.0-1') });
  assert.equal(same.verdict, 'same');
  const behind = npmParity(tarball(t, '3.15.0-0'), { drift: 'fail', tag: 'python3.15', registry: () => reg, pack });
  assert.equal(behind.verdict, 'behind');
  assert.match(behind.message, /sorts below npm python3\.15 3\.15\.0-1.*--tag python3\.15/);
  assert.equal(npmParity(tarball(t, '3.15.0-1'), { tag: 'python3.15', registry: () => null, pack }).verdict, 'no-latest');
  assert.equal(npmParity(tarball(t, '3.15.0-1'), { tag: 'python3.15', registry: () => ({ versions: ['1.0.0-1'], latest: null, tags: { beta: '1.0.0-1' } }), pack }).verdict, 'no-latest');
  assert.throws(() => npmParity(tarball(t, '3.15.0-1'), { tag: 'next', registry: () => reg, pack }), /reserved/);
});

test('3: list-semver-cleanup never lists a version under any dist-tag, and judges a tag channel against its tag', () => {
  const meta = (tags, versions) => ({ 'dist-tags': tags, versions: Object.fromEntries(versions.map((v) => [v, {}])) });
  const wave = cleanup(NAME, meta({ latest: '3.14.2-28', 'python3.15': '3.15.0-2' }, ['3.14.2-27', '3.14.2-28', '3.15.0-1', '3.15.0-2']));
  assert.deepEqual(wave.targets, []);
  const ahead = cleanup(NAME, meta({ latest: '3.14.2-28', 'python3.15': '3.15.0-2' }, ['3.14.2-28', '3.15.0-2', '3.15.0-3']));
  assert.deepEqual(ahead.targets.map((x) => [x.version, x.reason]), [['3.15.0-3', 'outranks-tag']]);
  const plain = cleanup(NAME, meta({ latest: '1.0.0-2', next: '1.0.0' }, ['1.0.0', '1.0.0-2']));
  assert.deepEqual(plain.targets, []);
  const untagged = cleanup(NAME, meta({ latest: '3.14.2-28' }, ['3.14.2-28', '3.15.0-1']));
  assert.deepEqual(untagged.targets.map((x) => x.version), ['3.15.0-1']);
});

test('4: the repo has at most one recipe per npm name and tag, and every multi-recipe name is allowlisted', () => {
  assert.deepEqual(channelProblems(), []);
});

test('4: a wave dir under its own tag, allowlisted, passes', (t) => {
  assert.deepEqual(channelProblems(fixture(t, WAVE, ALLOW), ALLOW), []);
});

test('4 NEGATIVE: two recipes under one tag, an unlisted second recipe, a stale entry and a bad tag all fail', (t) => {
  const twoLatest = fixture(t, { a: { version: '3.14.2-28' }, b: { version: '3.15.0-1', upstream: '3.15.0' } }, ALLOW);
  assert.match(channelProblems(twoLatest, ALLOW).join('\n'), /packages\/a and packages\/b all publish under latest/);
  const twoTagged = fixture(t, { ...WAVE, 'wasix-python3.15b': { tag: 'python3.15', version: '3.15.0-2', upstream: '3.15.0' } }, ALLOW);
  assert.match(channelProblems(twoTagged, ALLOW).join('\n'), /all publish under python3\.15/);
  const unlisted = fixture(t, WAVE, '');
  assert.match(channelProblems(unlisted, '').join('\n'), /has 2 recipes .* add "@ai-ecoverse\/wasix-python #<wave issue> <reason>"/);
  const stale = fixture(t, { 'wasix-python': { version: '3.14.2-28' } }, ALLOW);
  assert.match(channelProblems(stale, ALLOW).join('\n'), /entry "@ai-ecoverse\/wasix-python #1138 Python 3\.15 wave" is stale/);
  const bad = fixture(t, { x: { npm: '@ai-ecoverse/x', tag: 'certified', version: '1.0.0-1' } });
  assert.match(channelProblems(bad, '').join('\n'), /packages\/x\/recipe\.yaml: npm-tag "certified" is reserved/);
  assert.match(parseAllowlist(`${NAME} 1138 no hash\n`).problems.join(''), /is not "<@scope\/name> #<issue> <reason>"/);
  const retired = fixture(t, { ...WAVE, old: { version: '3.13.0-1', upstream: '3.13.0', builder: 'retired' } }, ALLOW);
  assert.deepEqual(channelProblems(retired, ALLOW), []);
});

test('5: name+version lookups pick the right dir when one name has two', (t) => {
  const root = fixture(t, WAVE, ALLOW);
  const list = ['wasix-python', 'wasix-python3.15'].map((d) => recipeOf(d, root));
  assert.equal(pickRecipe(list, NAME, '3.15.0-1').dir, 'wasix-python3.15');
  assert.equal(pickRecipe(list, NAME, '3.15.0-7').dir, 'wasix-python3.15');
  assert.equal(pickRecipe(list, NAME, '3.14.2-20').dir, 'wasix-python');
  assert.equal(pickRecipe(list, NAME, 'python3.15').dir, 'wasix-python3.15');
  assert.equal(pickRecipe(list, NAME).dir, 'wasix-python');
  assert.equal(pickRecipe(list, NAME, 'latest').dir, 'wasix-python');
  assert.equal(pickRecipe(list, '@ai-ecoverse/nope', '1.0.0-1'), null);
});

test('5: ladder-merge-resolve: a sibling dir\'s certified= line is not a stale line for this dir', () => {
  const text = `certified=${'a'.repeat(64)} ${NAME} 3.14.2-29\ncertified=${'b'.repeat(64)} ${NAME} 3.15.0-1`;
  assert.equal(certFor(text, NAME, '3.15.0-1', ['3.14.2-29']), 'b'.repeat(64));
  assert.equal(certFor(text, NAME, '3.14.2-29', ['3.15.0-1']), 'a'.repeat(64));
  assert.throws(() => certFor(text, NAME, '3.15.0-1'), /also @ai-ecoverse\/wasix-python 3\.14\.2-29/);
  assert.throws(() => certFor(`${text}\ncertified=${'c'.repeat(64)} ${NAME} 3.15.0-0`, NAME, '3.15.0-1', ['3.14.2-29']), /also .* 3\.15\.0-0/);
  const files = { 'packages/wasix-python/package/package.json': { name: NAME, version: '3.14.2-29' }, 'packages/wasix-python3.15/package/package.json': { name: NAME, version: '3.15.0-1' }, 'packages/zlib/package/package.json': { name: '@ai-ecoverse/wasm-zlib', version: '1.3.1-2' } };
  const show = (p) => {
    if (!files[p]) throw new Error('missing');
    return JSON.stringify(files[p]);
  };
  assert.deepEqual(siblingVersions('wasix-python3.15', NAME, 'HEAD', show, () => 'wasix-python\nwasix-python3.15\nzlib\nempty\n'), ['3.14.2-29']);
});

test('5: peer-tarball: a flat package.tgz of the sibling dir falls through to the registry; a stale one of this dir still fails', (t) => {
  const root = fixture(t, WAVE, ALLOW);
  const peers = join(root, 'peers');
  mkdirSync(peers);
  const put = (version) => {
    const buf = tarball(t, version);
    writeFileSync(join(peers, 'package.tgz'), buf);
    writeFileSync(join(peers, 'package.tgz.sha256'), `${execFileSync('shasum', ['-a', '256'], { input: buf, encoding: 'utf8' }).split(' ')[0]}  package.tgz\n`);
  };
  put('3.14.2-28');
  assert.equal(peerTarball('wasix-python3.15', { env: { HOMESCOOP_CERT_PEERS: peers }, base: root }), `${NAME}@3.15.0-1`);
  put('3.15.0-1');
  assert.equal(peerTarball('wasix-python3.15', { env: { HOMESCOOP_CERT_PEERS: peers }, base: root }), join(peers, 'package.tgz'));
  put('3.15.0-0');
  assert.throws(() => peerTarball('wasix-python3.15', { env: { HOMESCOOP_CERT_PEERS: peers }, base: root }), /wants @ai-ecoverse\/wasix-python@3\.15\.0-1/);
});

test('5: the README table has one row per dir and shows the wave dir\'s tag', (t) => {
  const table = renderTable(fixture(t, WAVE, ALLOW));
  const rows = table.split('\n').filter((l) => l.includes('[recipe]'));
  assert.equal(rows.length, 2);
  assert.match(rows[0], /^\| \[`@ai-ecoverse\/wasix-python`\]\([^)]+\) \| \[recipe\]\(packages\/wasix-python\) \|/);
  assert.match(rows[1], /^\| \[`@ai-ecoverse\/wasix-python`\]\([^)]+\) \(dist-tag `python3\.15`\) \| \[recipe\]\(packages\/wasix-python3\.15\) \|/);
});

test('5: known-inputs: a listed input only expires by a successor in its own channel', () => {
  const at = (dir) => ({ repository: { directory: `packages/${dir}/package` } });
  assert.equal(sameChannel(at('wasix-python3.15'), '3.15.0-1', at('wasix-python3.15'), '3.15.0-2'), true);
  assert.equal(sameChannel(at('wasix-python3.15'), '3.15.0-1', at('wasix-python'), '3.14.2-30'), false);
  assert.equal(sameChannel(at('wasix-python'), '3.14.2-20', at('wasix-python3.15'), '3.15.0-1'), false);
  assert.equal(sameChannel(at('wasix-python3.15'), '3.15.0-1', at('wasix-python'), '3.15.0-5'), true);
  assert.equal(sameChannel(at('zlib'), '1.3.1-2', at('zlib'), '1.4.0-1'), true);
  assert.equal(sameChannel({}, '1.3.1-2', at('zlib'), '1.4.0-1'), true);
});

test('5: issue labels: a wave dir of wasix-python is area:python', () => {
  assert.equal(areaOf('wasix-python3.15'), 'area:python');
  assert.equal(areaOf('wasix-python'), 'area:python');
  assert.equal(areaOf('wasix-pythonx'), null);
});
