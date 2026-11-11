/**
 * wasi-eza 0.23.5-3: eza lists the process's working directory, not a stale
 * PWD. wasi-libc's current_dir() is "/" at start whatever the cwd, so 0001's
 * start() changes into the real one; 0.23.5-1 took PWD as it was. A parent
 * can set a child's cwd without rewriting PWD (Node's spawnSync with
 * { cwd }, on real Node too): eza then listed the parent's directory. `/`
 * stays the root (start() still closes the ./ preopen after the chdir).
 */
export default async function (ctx) {
  const { run, write, assert } = ctx;
  const P = 'home/ezacwd';
  const D = `/${P}/sub`;
  await write(`${P}/sub/only-in-sub.txt`, 'x\n');
  await write(`${P}/sub/inner/x.md`, 'x\n');
  await write('tmp/ezacwd-only-in-tmp.txt', 'x\n');
  const out = (label, r) => `${label} → rc=${r.status}\n${r.stdout}${r.stderr}`;
  const listed = (label, r) => {
    assert.equal(r.status, 0, out(label, r));
    assert.equal(r.stdout, 'inner\nonly-in-sub.txt\n', `eza -1 lists the cwd: ${out(label, r)}`);
  };
  const relatives = (label, r) => {
    assert.equal(r.stdout, '../sub/only-in-sub.txt\n\ninner:\nx.md\n', `relative paths: ${out(label, r)}`);
  };
  const rootListing = (label, r) => {
    assert.equal(r.status, 0, out(label, r));
    assert.match(r.stdout, /^home$/m, `eza / is the root: ${out(label, r)}`);
    assert.doesNotMatch(r.stdout, /only-in-sub/, `eza / is the root: ${out(label, r)}`);
  };

  await write('tmp/eza-cwd.mjs', `
import { spawnSync } from 'node:child_process';
const D = ${JSON.stringify(D)};
const list = (opts) => {
  const r = spawnSync('eza', ['-1'], { cwd: D, encoding: 'utf8', ...opts });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error ? String(r.error) : null };
};
const noPwd = { ...process.env };
delete noPwd.PWD;
console.log(JSON.stringify({
  pwd: process.env.PWD,
  cwd: process.cwd(),
  stale: list({}),
  shell: spawnSync('sh', ['-c', 'eza -1'], { cwd: D, encoding: 'utf8' }),
  noPwd: list({ env: noPwd }),
  rel: spawnSync('eza', ['-1', 'inner', '../sub/only-in-sub.txt'], { cwd: D, encoding: 'utf8' }),
  root: spawnSync('eza', ['-1', '/'], { cwd: D, encoding: 'utf8' }),
}));
`);
  const node = await run(['node', '/tmp/eza-cwd.mjs'], { cwd: '/tmp' });
  assert.equal(node.status, 0, `node → ${node.status} stderr=${node.stderr}`);
  const got = JSON.parse(node.stdout);
  assert.equal(got.pwd, '/tmp', 'node runs with PWD=/tmp');
  assert.equal(got.cwd, '/tmp');
  assert.equal(got.stale.error, null);
  listed('node spawnSync { cwd: D }, PWD=/tmp inherited', got.stale);
  listed('node spawnSync sh -c, { cwd: D }', got.shell);
  listed('node spawnSync { cwd: D }, no PWD', got.noPwd);
  relatives('node spawnSync relative paths, PWD=/tmp', got.rel);
  rootListing('node spawnSync eza /, PWD=/tmp', got.root);

  for (const [label, env] of [
    ['PWD is the cwd', {}],
    ['PWD=/tmp', { PWD: '/tmp' }],
    ['PWD=/nonexistent', { PWD: '/nonexistent' }],
    ['PWD=sub', { PWD: 'sub' }],
    ['PWD with ..', { PWD: `/${P}/inner/../sub` }],
    ['PWD=/', { PWD: '/' }],
  ]) {
    const r = await run(['eza', '-1'], { cwd: D, env });
    listed(label, r);
    const rel = await run(['eza', '-1', 'inner', '../sub/only-in-sub.txt'], { cwd: D, env });
    relatives(label, rel);
    const root = await run(['eza', '-1', '/'], { cwd: D, env });
    rootListing(label, root);
  }

  const top = await run(['eza', '-1'], { cwd: '/', env: { PWD: D } });
  assert.match(top.stdout, /^home$/m, out(`cwd / PWD=${D}`, top));
  assert.doesNotMatch(top.stdout, /only-in-sub/, out(`cwd / PWD=${D}`, top));
}
