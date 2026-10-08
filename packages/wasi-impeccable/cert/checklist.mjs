/**
 * wasi-impeccable: detect + file-local verbs, relative paths from a non-root
 * cwd, and clear refusals. The HTTP verbs (install, check, generate-image,
 * concept-seed) need a network transport this page does not give the kernel;
 * test/e2e/http.test.mjs covers them on the Node entry.
 */
export default async function (ctx) {
  const { run, write, read, assert } = ctx;

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

  // Non-root cwd: relative paths resolve against the directory the command
  // runs in (PWD). wasi-libc's current_dir() stays `/`, which 0.1.12-4 used.
  const relDetect = await run(['impeccable', 'detect', '--json', 'dirty.html'], { cwd: '/home/site' });
  assert.equal(relDetect.status, 2, `relative detect from /home/site should exit 2; stderr=${relDetect.stderr}`);
  const relFindings = JSON.parse(relDetect.stdout);
  const relIds = new Set(relFindings.map((f) => f.antipattern));
  assert.ok(relIds.has('overused-font'), `relative detect findings=${[...relIds].join(',')}`);
  // 0.1.12-4 reported these as /dirty.html.
  const relFiles = [...new Set(relFindings.map((f) => f.file))];
  assert.deepEqual(relFiles, ['/home/site/dirty.html'], `relative detect files=${relFiles.join(',')}`);
  await write('home/site/sub/comps/.keep', '');
  const fake = await run(
    ['impeccable', 'generate-image', '--prompt', 'a calm hero', '--out', 'comps/fake.png'],
    { cwd: '/home/site/sub', env: { IMPECCABLE_IMAGE_GEN_FAKE: '1' } },
  );
  assert.equal(fake.status, 0, `fake generate-image stderr=${fake.stderr}`);
  assert.match(fake.stdout, /IMAGE: comps\/fake\.png .*no API call/, `fake stdout=${JSON.stringify(fake.stdout)}`);
  assert.notEqual(await read('home/site/sub/comps/fake.png'), null, 'comps/fake.png not written under the cwd');
  assert.equal(await read('comps/fake.png'), null, 'comps/fake.png written under / instead of the cwd');

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

  // generate-image is wired (0.1.12-5): without a key it says so.
  const noKey = await run(['impeccable', 'generate-image'], { cwd: '/home' });
  assert.equal(noKey.status, 1, `generate-image status=${noKey.status}`);
  assert.match(noKey.stderr, /OPENAI_API_KEY is not set/, `generate-image stderr=${JSON.stringify(noKey.stderr)}`);

  // Deferred verbs: clear refusal, not Unknown command.
  for (const verb of ['serve-question', 'font-match']) {
    const unavailable = await run(['impeccable', verb], { cwd: '/home' });
    assert.equal(unavailable.status, 1, `${verb} status=${unavailable.status}`);
    assert.match(unavailable.stderr, /not available in this build yet/, `${verb} stderr=${JSON.stringify(unavailable.stderr)}`);
    assert.ok(!/Unknown command/.test(unavailable.stderr), `${verb} must not say Unknown command`);
  }

  // live is wired (wasm32-wasip1-threads): in a directory without project
  // context it says what is missing instead of refusing.
  const live = await run(['impeccable', 'live'], { cwd: '/home' });
  assert.equal(live.status, 0, `live status=${live.status} stderr=${live.stderr}`);
  const liveInfo = JSON.parse(live.stdout);
  assert.equal(liveInfo.ok, false, `live stdout=${live.stdout}`);
  assert.match(liveInfo.error, /context_missing|config_missing|target_selection_required/, `live stdout=${live.stdout}`);

  // Closed stdin must not hang: install exits non-zero within seconds.
  const installEof = await run(['impeccable', 'install'], {
    cwd: '/home',
    stdin: '',
  });
  assert.equal(installEof.status, 1, `install EOF status=${installEof.status}`);
  assert.match(
    installEof.stderr + installEof.stdout,
    /no harness selected/,
    `install EOF=${JSON.stringify(installEof.stderr + installEof.stdout)}`,
  );

  // URL detect: WASI message, not puppeteer npm advice.
  const url = await run(['impeccable', 'detect', 'https://example.com'], { cwd: '/home' });
  assert.equal(url.status, 1, `URL detect status=${url.status}`);
  assert.match(
    url.stderr,
    /URL scans need a browser; not available in this build yet/,
    `URL detect stderr=${JSON.stringify(url.stderr)}`,
  );
  assert.ok(!/puppeteer/i.test(url.stderr), 'must not mention puppeteer');
}
