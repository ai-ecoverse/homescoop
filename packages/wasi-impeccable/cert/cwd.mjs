/**
 * wasi-impeccable 0.1.18-2: relative paths resolve against the process's
 * working directory, not a stale PWD. wasi-libc's current_dir() is "/"
 * whatever the cwd, so 0001's process_cwd() finds the real one; 0.1.18-1
 * took PWD as it was. A parent can set a child's cwd without rewriting PWD
 * (Node's spawnSync with { cwd }, on real Node too): impeccable then looked
 * for the file in the parent's directory ("cannot access dirty.html").
 */
export default async function (ctx) {
  const { run, write, assert } = ctx;
  const P = 'home/impcwd';
  const D = `/${P}/site`;
  const dirty = `<!doctype html>
<html><head><style>
body { font-family: Inter, Arial, sans-serif; color: #000; background: #fff; }
.hero { background: linear-gradient(135deg, #667eea, #764ba2); }
</style></head><body>
<div class="hero"><h1>Hello</h1><p style="color:#999">gray on purple</p></div>
</body></html>
`;
  await write(`${P}/site/dirty.html`, dirty);
  await write(`${P}/other/.keep`, '');
  const out = (label, r) => `${label} → rc=${r.status}\n${r.stdout.slice(0, 400)}${r.stderr}`;

  for (const [label, env] of [
    ['PWD is the cwd', {}],
    ['PWD=/tmp', { PWD: '/tmp' }],
    ['PWD=/nonexistent', { PWD: '/nonexistent' }],
    ['PWD=site', { PWD: 'site' }],
    ['PWD with ..', { PWD: `/${P}/other/../site` }],
    ['PWD=/', { PWD: '/' }],
  ]) {
    const r = await run(['impeccable', 'detect', '--json', 'dirty.html'], { cwd: D, env });
    assert.equal(r.status, 2, out(label, r));
    const findings = JSON.parse(r.stdout);
    assert.ok(findings.some((f) => f.antipattern === 'overused-font'), out(label, r));
    assert.deepEqual([...new Set(findings.map((f) => f.file))], [`${D}/dirty.html`], out(label, r));
  }

  // The cwd is / and PWD names the site: there is no /dirty.html.
  const top = await run(['impeccable', 'detect', '--json', 'dirty.html'], { cwd: '/', env: { PWD: D } });
  assert.notEqual(top.status, 2, out(`cwd / PWD=${D}`, top));
  assert.match(top.stderr, /cannot access dirty\.html/, out(`cwd / PWD=${D}`, top));
}
