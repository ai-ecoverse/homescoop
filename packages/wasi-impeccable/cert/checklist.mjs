/**
 * wasi-impeccable: detect on file/dir samples, config ignore, clean errors.
 */
export default async function (ctx) {
  const { run, write, assert } = ctx;

  const ver = await run(['impeccable', '--version'], { cwd: '/home' });
  assert.equal(ver.status, 0, `--version stderr=${ver.stderr}`);
  // Patch prints the engine/crate version (0.1.12), not upstream's npm CLI_VERSION (4.0.0).
  assert.equal(ver.stdout.trim(), '0.1.12', `version=${JSON.stringify(ver.stdout)}`);

  const dirty = `<!doctype html>
<html><head><style>
body { font-family: Inter, Arial, sans-serif; color: #000; background: #fff; }
.hero { background: linear-gradient(135deg, #667eea, #764ba2); }
</style></head><body>
<div class="hero"><h1>Hello</h1><p style="color:#999">gray on purple</p></div>
</body></html>
`;
  const cleanHtml = '<!doctype html><html><body>Hi</body></html>\n';

  await write('home/site/dirty.html', dirty);
  await write('home/site/clean.html', cleanHtml);

  const det = await run(['impeccable', 'detect', '--json', '/home/site/dirty.html'], {
    cwd: '/home',
  });
  assert.equal(det.status, 2, `detect with findings should exit 2; stderr=${det.stderr}`);
  const findings = JSON.parse(det.stdout);
  const ids = new Set(findings.map((f) => f.antipattern));
  for (const want of ['overused-font', 'ai-color-palette', 'low-contrast']) {
    assert.ok(ids.has(want), `missing rule ${want}; got ${[...ids].join(',')}`);
  }

  const clean = await run(['impeccable', 'detect', '--json', '/home/site/clean.html'], {
    cwd: '/home',
  });
  assert.equal(clean.status, 0, `clean detect stderr=${clean.stderr} stdout=${clean.stdout}`);
  assert.equal(clean.stdout.trim(), '[]', `clean stdout=${JSON.stringify(clean.stdout)}`);

  // Directory: dirty + clean; findings name only the dirty file; exit 2.
  const dir = await run(['impeccable', 'detect', '--json', '/home/site'], { cwd: '/home' });
  assert.equal(dir.status, 2, `dir detect should exit 2; stderr=${dir.stderr}`);
  const dirFindings = JSON.parse(dir.stdout);
  assert.ok(dirFindings.length > 0, 'dir scan expected findings');
  const dirFiles = new Set(dirFindings.map((f) => f.file));
  assert.ok(
    [...dirFiles].some((f) => String(f).endsWith('/site/dirty.html') || String(f).endsWith('dirty.html')),
    `dir findings should name dirty.html; files=${[...dirFiles].join(',')}`,
  );
  assert.ok(
    ![...dirFiles].some((f) => String(f).includes('clean.html')),
    `dir findings must not name clean.html; files=${[...dirFiles].join(',')}`,
  );
  const dirIds = new Set(dirFindings.map((f) => f.antipattern));
  for (const want of ['overused-font', 'ai-color-palette', 'low-contrast']) {
    assert.ok(dirIds.has(want), `dir missing rule ${want}; got ${[...dirIds].join(',')}`);
  }

  // Engine sets had_operational_failure → exit 1 (not 0) with this warning.
  const miss = await run(['impeccable', 'detect', '/home/no-such-file.html'], {
    cwd: '/home',
  });
  assert.equal(miss.status, 1, `missing path should exit 1, got ${miss.status}`);
  assert.match(
    miss.stderr,
    /Warning: cannot access \/home\/no-such-file\.html/,
    `stderr=${JSON.stringify(miss.stderr)}`,
  );

  const bad = await run(['impeccable', 'not-a-real-verb'], { cwd: '/home' });
  assert.equal(bad.status, 1, `unknown verb should exit 1, got ${bad.status}`);
  assert.match(bad.stderr, /Unknown command/, `stderr=${JSON.stringify(bad.stderr)}`);

  // Disable one rule via ignores → .impeccable/config.json; that id disappears.
  const add = await run(
    ['impeccable', 'ignores', 'add-rule', 'overused-font', '--all-values'],
    { cwd: '/home' },
  );
  assert.equal(add.status, 0, `ignores add-rule stderr=${add.stderr}`);
  const after = await run(['impeccable', 'detect', '--json', '/home/site/dirty.html'], {
    cwd: '/home',
  });
  assert.equal(after.status, 2, `still findings after one ignore; stderr=${after.stderr}`);
  const afterIds = new Set(JSON.parse(after.stdout).map((f) => f.antipattern));
  assert.ok(!afterIds.has('overused-font'), `overused-font should be gone; got ${[...afterIds]}`);
  assert.ok(afterIds.has('ai-color-palette'), 'ai-color-palette should remain');
  assert.ok(afterIds.has('low-contrast'), 'low-contrast should remain');
}
