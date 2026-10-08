/**
 * wasi-impeccable: detect anti-patterns on a small HTML sample; clean errors.
 */
export default async function (ctx) {
  const { run, write, assert } = ctx;

  const ver = await run(['impeccable', '--version'], { cwd: '/home' });
  assert.equal(ver.status, 0, `--version stderr=${ver.stderr}`);
  assert.match(ver.stdout.trim(), /^\d+\.\d+\.\d+$/, `version=${JSON.stringify(ver.stdout)}`);

  const probe = await run(['impeccable', 'engine-probe'], { cwd: '/home' });
  assert.equal(probe.status, 0, `engine-probe stderr=${probe.stderr}`);
  assert.match(
    probe.stdout.trim(),
    /^impeccable-engine 0\.1\.12$/,
    `engine-probe=${JSON.stringify(probe.stdout)}`,
  );

  await write(
    'home/sample.html',
    `<!doctype html>
<html><head><style>
body { font-family: Inter, Arial, sans-serif; color: #000; background: #fff; }
.card { border-radius: 16px; }
.hero { background: linear-gradient(135deg, #667eea, #764ba2); }
</style></head><body>
<div class="card hero"><h1>Hello</h1><p style="color:#999">gray on white</p></div>
</body></html>
`,
  );

  const det = await run(['impeccable', 'detect', '--json', '/home/sample.html'], {
    cwd: '/home',
  });
  // Upstream: exit 2 when primary findings exist; 0 when clean; 1 on ops failure.
  assert.equal(det.status, 2, `detect with findings should exit 2; stderr=${det.stderr}`);
  const findings = JSON.parse(det.stdout);
  assert.ok(Array.isArray(findings) && findings.length > 0, 'expected findings');
  const ids = new Set(findings.map((f) => f.antipattern));
  assert.ok(
    ids.has('overused-font') || ids.has('ai-color-palette') || ids.has('low-contrast'),
    `expected a known rule, got ${[...ids].join(',')}`,
  );

  // Minimal markup with no primary findings → exit 0.
  await write('home/bare.html', '<!doctype html><html><body>Hi</body></html>\n');
  const clean = await run(['impeccable', 'detect', '--json', '/home/bare.html'], {
    cwd: '/home',
  });
  assert.equal(clean.status, 0, `clean detect stderr=${clean.stderr} stdout=${clean.stdout}`);
  assert.equal(clean.stdout.trim(), '[]', `clean stdout=${JSON.stringify(clean.stdout)}`);

  const bad = await run(['impeccable', 'not-a-real-verb'], { cwd: '/home' });
  assert.equal(bad.status, 1, `unknown verb should exit 1, got ${bad.status}`);
  assert.match(bad.stderr, /Unknown command/, `stderr=${JSON.stringify(bad.stderr)}`);

  const miss = await run(['impeccable', 'detect', '/home/no-such-file.html'], {
    cwd: '/home',
  });
  // Upstream warns and exits 0 when no files are scanned; still must not trap.
  assert.ok(miss.status === 0 || miss.status === 1, `missing status=${miss.status}`);
  assert.match(
    `${miss.stdout}${miss.stderr}`,
    /cannot access|No files|Warning/i,
    `missing output=${JSON.stringify(miss.stdout + miss.stderr)}`,
  );
}
