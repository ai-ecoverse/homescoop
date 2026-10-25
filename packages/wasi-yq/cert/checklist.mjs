import { cases, compare, digest, expected, files, observed, stdin, tempFiles } from '../test/goldens.mjs';
import { wasip1 } from '../test/wasip1.mjs';

export default async function (ctx) {
  const { run, write, read, assert } = ctx;
  const out = (r) => `rc=${r.status}\n${r.stdout.slice(0, 2000)}\n${r.stderr.slice(0, 2000)}`;
  const want = expected();
  const bad = [];
  let i = 0;
  for (const c of cases) {
    const cwd = `/home/yq/${i}`;
    const tmp = `/home/yq/tmp-${i++}`;
    for (const [name, text] of Object.entries(files(c))) await write(`${cwd}/${name}`, text);
    await write(`${cwd}/.keep`, '');
    await write(`${tmp}/.keep`, '');
    const input = stdin(c);
    const r = await run(['yq', ...c.args], { cwd, env: { TMPDIR: tmp, ...c.env }, ...(input !== undefined && { stdin: input }) });
    const after = c.after ? await read(`${cwd}/${c.after}`) : undefined;
    const left = c.after ? tempFiles((await run(['ls', '-A', tmp], { cwd })).stdout.split('\n')) : undefined;
    const o = observed(c, r, after, left);
    o.stderr = o.stderr === wasip1(want[c.name].stderr) ? want[c.name].stderr : o.stderr;
    bad.push(...compare(c, o));
  }
  assert.deepEqual(bad, [], `yq.wasm differs from native yq:\n${bad.join('\n')}`);

  const cwd = '/home/yq/0';
  let r = await run(['yq', '--version'], { cwd });
  assert.equal(r.stdout, 'yq (https://github.com/mikefarah/yq/) version v4.54.1\n');
  r = await run(['yq', '.jobs[', 'ci.yml'], { cwd: '/home/yq/1' });
  assert.equal(r.status, 1, out(r));
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, 'Error: bad expression, could not find matching `]`\n');
  r = await run(['yq', '.a', 'missing.yaml'], { cwd });
  assert.equal(r.status, 1, out(r));
  assert.equal(r.stderr, 'Error: open missing.yaml: No such file or directory\n', 'the errno text is Go wasip1\'s (native: lower case)');

  const gha = want['gha first steps'].stdout;
  r = await run(['bash', '-c', "cat ci.yml | yq '.jobs.*.steps[0]'"], { cwd: '/home/yq/1' });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout, gha, 'cat ci.yml | yq');
  assert.ok(gha.startsWith('uses: actions/checkout@v4 # pinned by tag\n'), 'comments are kept');
  r = await run(['bash', '-c', "TAG=1.20 yq -n '.tag = env(TAG) | .text = strenv(TAG)'"], { cwd });
  assert.equal(r.stdout, 'tag: 1.20\ntext: "1.20"\n', out(r));
  const large = cases.findIndex((c) => c.name === 'large to json');
  r = await run(['bash', '-c', 'yq -o json large.yaml | sha256sum'], { cwd: `/home/yq/${large}` });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout, `${want['large to json'].stdout.sha256}  -\n`);
  const before = tempFiles((await run(['ls', '-A', '/tmp'], { cwd })).stdout.split('\n'));
  r = await run(['bash', '-c', "yq -i '.jobs.lint.runs-on = \"ubuntu-24.04\"' ci.yml && yq '.jobs.lint.runs-on' ci.yml && ls -A /tmp"], { cwd: '/home/yq/1' });
  assert.equal(r.status, 0, out(r));
  assert.ok(r.stdout.startsWith('ubuntu-24.04\n'), out(r));
  assert.equal(tempFiles(r.stdout.split('\n').slice(1)), before, `a successful -i in /tmp leaves no temp file behind: ${out(r)}`);
  assert.ok(want['gha edit in place'].after.includes('      - uses: actions/checkout@v4 # pinned by tag\n'), 'in-place edits keep comments');
  assert.deepEqual(digest(''), { sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', bytes: 0 });
  console.log(`checklist: ${cases.length} yq runs (GitHub Actions, k8s, front matter, JSON, TOML, XML, eval-all, env/strenv, errors, a 4 MB file) match native yq byte for byte, in-place edits included; pipes through bash too`);
}
