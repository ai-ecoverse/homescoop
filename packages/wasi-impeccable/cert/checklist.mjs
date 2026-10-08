/**
 * wasi-impeccable: detect on file/dir samples, config ignores, clean errors.
 */
export default async function (ctx) {
  const { run, write, assert } = ctx;

  const ver = await run(['impeccable', '--version'], { cwd: '/home' });
  assert.equal(ver.status, 0, `--version stderr=${ver.stderr}`);
  assert.match(ver.stdout.trim(), /^\d+\.\d+\.\d+$/, `version=${JSON.stringify(ver.stdout)}`);

  const sample = `<!doctype html>
<html><head><style>
body { font-family: Inter, Arial, sans-serif; color: #000; background: #fff; }
.hero { background: linear-gradient(135deg, #667eea, #764ba2); }
</style></head><body>
<div class="hero"><h1>Hello</h1><p style="color:#999">gray on purple</p></div>
</body></html>
`;
  await write('home/pages/sample.html', sample);

  const det = await run(['impeccable', 'detect', '--json', '/home/pages/sample.html'], {
    cwd: '/home',
  });
  // Upstream: exit 2 when primary findings exist; 0 when clean; 1 on ops failure.
  assert.equal(det.status, 2, `detect with findings should exit 2; stderr=${det.stderr}`);
  const findings = JSON.parse(det.stdout);
  assert.ok(Array.isArray(findings) && findings.length > 0, 'expected findings');
  const ids = new Set(findings.map((f) => f.antipattern));
  for (const want of ['overused-font', 'ai-color-palette', 'low-contrast']) {
    assert.ok(ids.has(want), `missing rule ${want}; got ${[...ids].join(',')}`);
  }

  await write('home/bare.html', '<!doctype html><html><body>Hi</body></html>\n');
  const clean = await run(['impeccable', 'detect', '--json', '/home/bare.html'], {
    cwd: '/home',
  });
  assert.equal(clean.status, 0, `clean detect stderr=${clean.stderr} stdout=${clean.stdout}`);
  assert.equal(clean.stdout.trim(), '[]', `clean stdout=${JSON.stringify(clean.stdout)}`);

  const dir = await run(['impeccable', 'detect', '--json', '/home/pages'], { cwd: '/home' });
  assert.equal(dir.status, 2, `dir detect should exit 2; stderr=${dir.stderr}`);
  const dirIds = new Set(JSON.parse(dir.stdout).map((f) => f.antipattern));
  assert.ok(dirIds.has('overused-font'), `dir scan missing overused-font; got ${[...dirIds]}`);

  const miss = await run(['impeccable', 'detect', '/home/no-such-file.html'], {
    cwd: '/home',
  });
  assert.equal(miss.status, 1, `missing path should exit 1, got ${miss.status}`);
  assert.match(miss.stderr, /Warning: cannot access/, `stderr=${JSON.stringify(miss.stderr)}`);

  const bad = await run(['impeccable', 'not-a-real-verb'], { cwd: '/home' });
  assert.equal(bad.status, 1, `unknown verb should exit 1, got ${bad.status}`);
  assert.match(bad.stderr, /Unknown command/, `stderr=${JSON.stringify(bad.stderr)}`);

  // Honour .impeccable/config.json via `ignores add-rule` (writes shared config).
  const addFont = await run(
    ['impeccable', 'ignores', 'add-rule', 'overused-font', '--all-values'],
    { cwd: '/home' },
  );
  assert.equal(addFont.status, 0, `ignores add-rule overused-font stderr=${addFont.stderr}`);
  for (const rule of ['ai-color-palette', 'low-contrast', 'gray-on-color']) {
    const add = await run(['impeccable', 'ignores', 'add-rule', rule], { cwd: '/home' });
    assert.equal(add.status, 0, `ignores add-rule ${rule} stderr=${add.stderr}`);
  }
  const ignored = await run(['impeccable', 'detect', '--json', '/home/pages/sample.html'], {
    cwd: '/home',
  });
  assert.equal(ignored.status, 0, `ignoreRules detect stderr=${ignored.stderr}`);
  assert.equal(
    ignored.stdout.trim(),
    '[]',
    `ignoreRules should clear findings; got ${JSON.stringify(ignored.stdout)}`,
  );
}
