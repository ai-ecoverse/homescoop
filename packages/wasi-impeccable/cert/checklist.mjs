/**
 * wasi-impeccable: detect + file-local verbs; unavailable verbs refuse clearly.
 */
export default async function (ctx) {
  const { run, write, assert } = ctx;

  const ver = await run(['impeccable', '--version'], { cwd: '/home' });
  assert.equal(ver.status, 0, `--version stderr=${ver.stderr}`);
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

  // --- file-local verbs (0.1.12-4) ---
  const palette = await run(['impeccable', 'palette'], { cwd: '/home' });
  assert.equal(palette.status, 0, `palette stderr=${palette.stderr}`);
  assert.match(palette.stdout, /BRAND SEED/, `palette stdout=${JSON.stringify(palette.stdout.slice(0, 200))}`);

  const doctor = await run(['impeccable', 'doctor'], { cwd: '/home' });
  assert.equal(doctor.status, 0, `doctor stderr=${doctor.stderr}`);
  assert.match(doctor.stdout, /Impeccable doctor/, `doctor stdout=${JSON.stringify(doctor.stdout)}`);

  const context = await run(['impeccable', 'context'], { cwd: '/home' });
  assert.equal(context.status, 0, `context stderr=${context.stderr}`);
  assert.match(context.stdout, /RESOLVED_CONTEXT/, `context stdout=${JSON.stringify(context.stdout.slice(0, 300))}`);

  const signals = await run(['impeccable', 'signals'], { cwd: '/home' });
  assert.equal(signals.status, 0, `signals stderr=${signals.stderr}`);
  const sig = JSON.parse(signals.stdout);
  assert.ok(sig.setup, `signals missing setup; stdout=${signals.stdout.slice(0, 200)}`);

  const pin = await run(['impeccable', 'pin', 'pin', 'craft'], { cwd: '/home' });
  assert.equal(pin.status, 0, `pin stderr=${pin.stderr}`);
  assert.match(pin.stdout, /No harness directories|Pinned|pin/, `pin stdout=${JSON.stringify(pin.stdout)}`);

  const csp = await run(['impeccable', 'detect-csp', '/home/site/clean.html'], { cwd: '/home' });
  assert.equal(csp.status, 0, `detect-csp stderr=${csp.stderr}`);
  assert.match(csp.stdout, /"signals"/, `detect-csp stdout=${JSON.stringify(csp.stdout)}`);

  const brief = await run(['impeccable', 'surface-brief', 'list'], { cwd: '/home' });
  assert.equal(brief.status, 0, `surface-brief stderr=${brief.stderr}`);
  assert.equal(brief.stdout.trim(), '[]', `surface-brief stdout=${JSON.stringify(brief.stdout)}`);

  const critique = await run(['impeccable', 'critique-storage'], { cwd: '/home' });
  assert.equal(critique.status, 1, `critique-storage usage should exit 1; got ${critique.status}`);
  assert.match(
    critique.stdout + critique.stderr,
    /usage: impeccable critique-storage/,
    `critique=${JSON.stringify(critique.stdout + critique.stderr)}`,
  );

  const embed = await run(['impeccable', 'embed-prompt'], { cwd: '/home' });
  assert.ok(embed.status !== 0, `embed-prompt should refuse without image; status=${embed.status}`);
  assert.match(
    `${embed.stdout}${embed.stderr}`,
    /image file required/,
    `embed-prompt out=${JSON.stringify(embed.stdout)} err=${JSON.stringify(embed.stderr)}`,
  );

  const hooks = await run(['impeccable', 'hooks', 'status'], { cwd: '/home' });
  assert.equal(hooks.status, 0, `hooks status stderr=${hooks.stderr}`);
  assert.match(hooks.stdout, /Impeccable design hook/, `hooks=${JSON.stringify(hooks.stdout)}`);

  const before = await run(['impeccable', 'hook-before-edit'], { cwd: '/home' });
  assert.equal(before.status, 0, `hook-before-edit stderr=${before.stderr}`);
  assert.match(before.stdout, /"permission"\s*:\s*"allow"/, `before=${JSON.stringify(before.stdout)}`);

  const hook = await run(['impeccable', 'hook'], { cwd: '/home' });
  assert.equal(hook.status, 0, `hook stderr=${hook.stderr}`);

  const spec = await run(['impeccable', 'comp-spec'], { cwd: '/home' });
  assert.ok(spec.status !== 0 || /usage:|SCHEMA:|MAP WORKFLOW/.test(spec.stdout + spec.stderr),
    `comp-spec should show usage; status=${spec.status} out=${JSON.stringify((spec.stdout + spec.stderr).slice(0, 200))}`);
  assert.match(spec.stdout + spec.stderr, /comp-spec/, `comp-spec=${JSON.stringify((spec.stdout + spec.stderr).slice(0, 200))}`);

  const diff = await run(['impeccable', 'comp-diff'], { cwd: '/home' });
  assert.match(diff.stdout + diff.stderr, /usage:.*comp-diff/, `comp-diff=${JSON.stringify((diff.stdout + diff.stderr).slice(0, 200))}`);

  const check = await run(['impeccable', 'check'], { cwd: '/home' });
  assert.equal(check.status, 0, `check stderr=${check.stderr}`);
  assert.match(check.stdout, /not installed|up to date|Updates available/, `check=${JSON.stringify(check.stdout)}`);

  const linkHelp = await run(['impeccable', 'link', '--help'], { cwd: '/home' });
  assert.equal(linkHelp.status, 0, `link --help stderr=${linkHelp.stderr}`);
  assert.match(linkHelp.stdout, /Usage: impeccable link/, `link help=${JSON.stringify(linkHelp.stdout)}`);

  const help = await run(['impeccable', 'help'], { cwd: '/home' });
  assert.equal(help.status, 1, `help without network should exit 1; got ${help.status}`);
  assert.match(
    help.stderr + help.stdout,
    /needs network|Could not fetch command list|not available in this build yet/,
    `help=${JSON.stringify(help.stderr + help.stdout)}`,
  );

  // Deferred verbs: clear refusal, not Unknown command.
  const unavailable = await run(['impeccable', 'generate-image'], { cwd: '/home' });
  assert.equal(unavailable.status, 1, `generate-image status=${unavailable.status}`);
  assert.match(
    unavailable.stderr,
    /not available in this build yet/,
    `unavailable stderr=${JSON.stringify(unavailable.stderr)}`,
  );
  assert.ok(!/Unknown command/.test(unavailable.stderr), 'must not say Unknown command');

  const live = await run(['impeccable', 'live'], { cwd: '/home' });
  assert.equal(live.status, 1, `live status=${live.status}`);
  assert.match(live.stderr, /not available in this build yet/, `live stderr=${JSON.stringify(live.stderr)}`);
}
