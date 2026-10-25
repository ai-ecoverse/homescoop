/**
 * wasi-bat: bat's own syntax regression test (tests/syntax-tests in the
 * .crate) in the kernel. Every file of tests/syntax-tests/source is
 * highlighted as upstream's create_highlighted_versions.py does (--no-config
 * --style=plain --color=always --theme="Monokai Extended"
 * --italic-text=always, plus the directory's bat_options, COLORTERM=truecolor)
 * and must equal upstream's tests/syntax-tests/highlighted byte for byte.
 * For 0.26.1 that is 196 files in 158 directories: the bundled syntaxes and Oniguruma's
 * regexes on them. The .crate is the recipe's source, checked against its
 * sha256.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const recipe = readFileSync(new URL('../recipe.yaml', import.meta.url), 'utf8');
const VERSION = recipe.match(/^version: "([^"]+)"$/m)[1];
const SHA = recipe.match(/^ {2}sha256: "([0-9a-f]{64})"$/m)[1];
const URL_ = recipe.match(/^ {2}url: "([^"]+)"$/m)[1].replaceAll('{{version}}', VERSION);
const OPTIONS = ['--no-config', '--style=plain', '--color=always', '--theme=Monokai Extended', '--italic-text=always'];
const SKIP = new Set(['LICENSE.md', 'NOTICE', 'README.md', 'bat_options']);

function syntaxTests() {
  const dir = join(tmpdir(), `homescoop-wasi-bat-${SHA.slice(0, 12)}`);
  const crate = join(dir, `bat-${VERSION}.crate`);
  if (!existsSync(crate) || createHash('sha256').update(readFileSync(crate)).digest('hex') !== SHA) {
    mkdirSync(dir, { recursive: true });
    execFileSync('curl', ['-fsSL', '--retry', '5', '--retry-all-errors', '-o', `${crate}.part`, URL_]);
    const got = createHash('sha256').update(readFileSync(`${crate}.part`)).digest('hex');
    if (got !== SHA) throw new Error(`${URL_}: sha256 ${got}, recipe pins ${SHA}`);
    writeFileSync(crate, readFileSync(`${crate}.part`));
  }
  const root = join(dir, `bat-${VERSION}`, 'tests', 'syntax-tests');
  if (!existsSync(root)) execFileSync('tar', ['xzf', crate, '-C', dir, `bat-${VERSION}/tests/syntax-tests`]);
  return root;
}

const q = (s) => `'${s.replaceAll("'", "'\\''")}'`;

export default async function (ctx) {
  const { run, write, readBytes, assert } = ctx;
  const root = syntaxTests();
  const cases = [];
  for (const d of readdirSync(join(root, 'source')).sort()) {
    const opts = existsSync(join(root, 'source', d, 'bat_options'))
      ? readFileSync(join(root, 'source', d, 'bat_options'), 'utf8').split('\n').map((l) => l.trimEnd()).filter(Boolean)
      : [];
    for (const f of readdirSync(join(root, 'source', d)).sort()) {
      if (SKIP.has(f)) continue;
      const expected = join(root, 'highlighted', d, f);
      if (!existsSync(expected)) continue;
      cases.push({ d, f, opts, src: readFileSync(join(root, 'source', d, f)), expected: readFileSync(expected) });
    }
  }
  assert.ok(cases.length >= 150, `only ${cases.length} syntax tests in bat-${VERSION}.crate`);

  const cwd = '/home/syntax';
  const lines = ['set -u', 'fails=0'];
  for (const [i, c] of cases.entries()) {
    await write(`${cwd}/source/${c.d}/${c.f}`, c.src);
    const argv = ['bat', ...OPTIONS, ...c.opts, `source/${c.d}/${c.f}`].map(q).join(' ');
    lines.push(`${argv} > out/${i} 2> out/${i}.err || { echo "rc=$? ${c.d}/${c.f}"; fails=$((fails+1)); }`);
  }
  lines.push('echo "fails=$fails"');
  await write(`${cwd}/run.sh`, `${lines.join('\n')}\n`);
  const mk = await run(['mkdir', '-p', `${cwd}/out`], { cwd: '/home' });
  assert.equal(mk.status, 0, mk.stderr);
  const r = await run(['bash', 'run.sh'], { cwd, env: { COLORTERM: 'truecolor' } });
  assert.equal(r.status, 0, `run.sh: ${r.stdout.slice(-2000)} ${r.stderr.slice(-2000)}`);
  assert.match(r.stdout, /^fails=0\n$/m, `bat exited non-zero: ${r.stdout.slice(-2000)}`);

  const differ = [];
  for (const [i, c] of cases.entries()) {
    const got = await readBytes(`${cwd}/out/${i}`);
    if (!got || Buffer.compare(got, c.expected) !== 0) differ.push(`${c.d}/${c.f}`);
  }
  assert.deepEqual(differ, [], `${differ.length} of ${cases.length} differ from upstream's highlighted output`);
  console.log(`syntax: ${cases.length} of bat-${VERSION}'s syntax tests (${new Set(cases.map((c) => c.d)).size} directories) match upstream's highlighted output byte for byte`);
}
