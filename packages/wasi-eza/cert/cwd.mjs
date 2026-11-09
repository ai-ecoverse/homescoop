/**
 * wasi-eza 0.23.5-2: eza lists the process's working directory, not a stale
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

  for (const [label, env] of [
    ['PWD is the cwd', {}],
    ['PWD=/tmp', { PWD: '/tmp' }],
    ['PWD=/nonexistent', { PWD: '/nonexistent' }],
    ['PWD=sub', { PWD: 'sub' }],
    ['PWD with ..', { PWD: `/${P}/inner/../sub` }],
    ['PWD=/', { PWD: '/' }],
  ]) {
    const r = await run(['eza', '-1'], { cwd: D, env });
    assert.equal(r.status, 0, out(label, r));
    assert.equal(r.stdout, 'inner\nonly-in-sub.txt\n', `eza -1 lists the cwd: ${out(label, r)}`);
    const rel = await run(['eza', '-1', 'inner', '../sub/only-in-sub.txt'], { cwd: D, env });
    assert.equal(rel.stdout, '../sub/only-in-sub.txt\n\ninner:\nx.md\n', `relative paths: ${out(label, rel)}`);
    const root = await run(['eza', '-1', '/'], { cwd: D, env });
    assert.equal(root.status, 0, out(label, root));
    assert.match(root.stdout, /^home$/m, `eza / is the root: ${out(label, root)}`);
    assert.doesNotMatch(root.stdout, /only-in-sub/, `eza / is the root: ${out(label, root)}`);
  }

  // The cwd is / and PWD names the project: eza lists /.
  const top = await run(['eza', '-1'], { cwd: '/', env: { PWD: D } });
  assert.match(top.stdout, /^home$/m, out(`cwd / PWD=${D}`, top));
  assert.doesNotMatch(top.stdout, /only-in-sub/, out(`cwd / PWD=${D}`, top));
}
