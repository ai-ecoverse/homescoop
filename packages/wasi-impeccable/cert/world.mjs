export default async function ({ run, write, assert }) {
  const H = '/home/impworld';
  await write(`${H.slice(1)}/site/index.html`, '<!doctype html><html><body><h1>Hi</h1></body></html>\n');
  await write(`${H.slice(1)}/site/clip.webm`, 'not a recording\n');
  const site = `${H}/site`;
  const show = (label, r) => `${label} → rc=${r.status}\n--- stdout\n${r.stdout.slice(0, 600)}\n--- stderr\n${r.stderr.slice(0, 600)}`;
  const imp = (args, env = {}) => run(['impeccable', ...args], { cwd: site, env: { HOME: H, ...env } });
  const refuses = async (args, reason) => {
    const label = args.join(' ');
    const r = await imp(args);
    assert.equal(r.status, 1, show(label, r));
    assert.match(r.stderr, new RegExp(`^impeccable ${args[0]}: ${reason}; not available in this build yet$`, 'm'), show(label, r));
    assert.ok(!/Unknown command|panicked|wasm trap|unreachable/.test(r.stderr), show(label, r));
    assert.equal(r.stdout, '', show(label, r));
  };

  await refuses(['world', 'teletext-service'], 'needs Impeccable account sign-in');
  await refuses(['world', 'teletext-service', '--print'], 'needs Impeccable account sign-in');
  await refuses(['taste-refresh'], 'needs Impeccable account sign-in');
  await refuses(['walkthrough', 'clip.webm', '--chapter', '0:01=Start'], 'needs ffmpeg');

  const files = await run(['ls', '-A', site], { cwd: site });
  assert.equal(files.status, 0, show('ls site', files));
  assert.deepEqual(files.stdout.split('\n').filter(Boolean).sort(), ['clip.webm', 'index.html'], show('ls site', files));
  const home = await run(['ls', '-A', H], { cwd: site });
  assert.equal(home.status, 0, show('ls home', home));
  assert.deepEqual(home.stdout.split('\n').filter(Boolean), ['site'], show('ls home', home));

  const status = await imp(['loop', 'status']);
  assert.equal(status.status, 1, show('loop status', status));
  assert.match(status.stderr, /^Impeccable Loop is only available on macOS\.$/m, show('loop status', status));
  assert.equal(status.stdout, '', show('loop status', status));
  for (const args of [['loop', 'status', '--json'], ['loop', 'connect', '--json'], ['loop', 'connect', '--agent', 'claude', '--json']]) {
    const r = await imp(args);
    assert.equal(r.status, 1, show(args.join(' '), r));
    assert.deepEqual(JSON.parse(r.stdout), { ok: false, error: 'Impeccable Loop is only available on macOS.' }, show(args.join(' '), r));
  }
  const usage = await imp(['loop']);
  assert.equal(usage.status, 1, show('loop', usage));
  assert.match(usage.stderr, /^ +impeccable loop connect \[--agent claude\|codex\] \[--json\]$/m, show('loop', usage));
  assert.match(usage.stderr, /^ +impeccable loop status \[--json\]$/m, show('loop', usage));

  const T = '/home/imptaste';
  const now = Math.floor(Date.now() / 1000) - 120;
  const taste = {
    version: 1,
    issuer: 'https://api.impeccable.style',
    fetchedAt: now,
    state: 'ready',
    rules: [
      { id: 'one', text: 'Keep corners square.', direction: 'prefer' },
      { id: 'two', text: 'Small uppercase kicker labels.', direction: 'avoid' },
    ],
  };
  await write(`${T.slice(1)}/.impeccable/taste.json`, `${JSON.stringify(taste)}\n`);
  await write(`${T.slice(1)}/site/index.html`, '<!doctype html><html><body><h1>Hi</h1></body></html>\n');
  const quiet = { HOME: T, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1', IMPECCABLE_NO_TELEMETRY: '1' };
  const context = await run(['impeccable', 'context'], { cwd: `${T}/site`, env: quiet });
  assert.equal(context.status, 0, show('context with a cached taste', context));
  assert.match(context.stdout, /^YOUR_TASTE: the person's own standing design preferences, read from their Impeccable account\./m, show('context with a cached taste', context));
  assert.match(context.stdout, /^- Prefer: Keep corners square\.$/m, show('context with a cached taste', context));
  assert.match(context.stdout, /^- Avoid: Small uppercase kicker labels\.$/m, show('context with a cached taste', context));
  const off = await run(['impeccable', 'context'], { cwd: `${T}/site`, env: { ...quiet, IMPECCABLE_NO_TASTE: '1' } });
  assert.equal(off.status, 0, show('context with IMPECCABLE_NO_TASTE=1', off));
  assert.ok(!/YOUR_TASTE/.test(off.stdout), show('context with IMPECCABLE_NO_TASTE=1', off));
}
