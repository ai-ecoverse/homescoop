/**
 * wasi-uv 0.13.6-3: uv finds the project from the process's working
 * directory, not a stale PWD. wasi-libc's current_dir() is "/" at start
 * whatever the cwd, so 0005 changes into the real one; 0.13.6-2 took PWD as
 * it was. A parent can set a child's cwd without rewriting PWD (Node's
 * spawnSync with { cwd }, on real Node too): uv then looked for
 * pyproject.toml from the parent's directory.
 */
export default async function (ctx) {
  const { run, write, assert } = ctx;
  const P = 'home/uvcwd/proj';
  const D = `/${P}/sub`;
  await write(`${P}/pyproject.toml`, '[project]\nname = "cwdcase"\nversion = "1.2.3"\nrequires-python = ">=3.14"\ndependencies = []\n');
  await write(`${P}/sub/.keep`, '');
  await write(`${P}/other/.keep`, '');
  const base = { UV_NO_PROGRESS: '1', UV_CACHE_DIR: '/tmp/uvcwd-cache' };
  const out = (label, r) => `${label} → rc=${r.status}\n${r.stdout}${r.stderr}`;

  for (const [label, env] of [
    ['PWD is the cwd', {}],
    ['PWD=/tmp', { PWD: '/tmp' }],
    ['PWD=/nonexistent', { PWD: '/nonexistent' }],
    ['PWD=sub', { PWD: 'sub' }],
    ['PWD with ..', { PWD: `/${P}/other/../sub` }],
    ['PWD=/', { PWD: '/' }],
  ]) {
    const r = await run(['uv', 'version', '--offline'], { cwd: D, env: { ...base, ...env } });
    assert.equal(r.status, 0, out(label, r));
    assert.equal(r.stdout, 'cwdcase 1.2.3\n', out(label, r));
  }

  // The cwd is / and PWD names the project: there is no project above /.
  const top = await run(['uv', 'version', '--offline'], { cwd: '/', env: { ...base, PWD: D } });
  assert.equal(top.status, 2, out(`cwd / PWD=${D}`, top));
  assert.match(top.stderr, /No `pyproject\.toml` found in current directory or any parent directory/, out(`cwd / PWD=${D}`, top));
}
