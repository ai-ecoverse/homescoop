/**
 * wasi-fnox 1.46.0-2: fnox finds fnox.toml from the process's working
 * directory, not a stale PWD. wasi-libc's current_dir() is "/" at start
 * whatever the cwd, so 0004 changes into the real one; 1.46.0-1 took PWD as
 * it was. A parent can set a child's cwd without rewriting PWD (Node's
 * spawnSync with { cwd }, on real Node too): fnox then looked for its
 * configuration from the parent's directory ("No configuration file found
 * in /tmp or any parent directory").
 */
export default async function (ctx) {
  const { run, write, assert } = ctx;
  const P = 'home/fnoxcwd';
  const D = `/${P}/sub/dir`;
  await write(`${P}/fnox.toml`, '[providers.plain]\ntype = "plain"\n\n[secrets]\nCWDCASE = { provider = "plain", value = "from-the-project" }\n');
  await write(`${P}/sub/dir/.keep`, '');
  await write(`${P}/other/.keep`, '');
  const out = (label, r) => `${label} → rc=${r.status}\n${r.stdout}${r.stderr}`;

  for (const [label, env] of [
    ['PWD is the cwd', {}],
    ['PWD=/tmp', { PWD: '/tmp' }],
    ['PWD=/nonexistent', { PWD: '/nonexistent' }],
    ['PWD=dir', { PWD: 'dir' }],
    ['PWD with ..', { PWD: `/${P}/other/../sub/dir` }],
    ['PWD=/', { PWD: '/' }],
  ]) {
    const r = await run(['fnox', 'get', 'CWDCASE'], { cwd: D, env });
    assert.equal(r.status, 0, out(label, r));
    assert.equal(r.stdout.trim(), 'from-the-project', out(label, r));
  }

  // The cwd is / and PWD names the project: no configuration above /.
  const top = await run(['fnox', 'get', 'CWDCASE'], { cwd: '/', env: { PWD: D } });
  assert.notEqual(top.status, 0, out(`cwd / PWD=${D}`, top));
  assert.match(top.stderr, /No configuration file found in \/ or any parent directory/, out(`cwd / PWD=${D}`, top));
}
