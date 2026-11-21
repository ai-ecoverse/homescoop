export default async function ({ run, write, assert }) {
  const H = '/home/impsetup';
  await write(`${H.slice(1)}/.keep`, '');
  const show = (label, r) => `${label} → rc=${r.status}\n--- stdout\n${r.stdout.slice(0, 600)}\n--- stderr\n${r.stderr.slice(0, 600)}`;
  const imp = (args) => run(['impeccable', ...args], { cwd: H, env: { HOME: H } });

  for (const args of [['setup'], ['setup', 'on'], ['setup-report'], ['critiques'], ['critiques', 'on'], ['critiques-refresh'], ['health-design-refresh']]) {
    const label = args.join(' ');
    const r = await imp(args);
    assert.equal(r.status, 1, show(label, r));
    assert.match(
      r.stderr,
      new RegExp(`^impeccable ${args[0]}: needs Impeccable account sign-in; not available in this build yet$`, 'm'),
      show(label, r),
    );
    assert.ok(!/Unknown command|panicked|wasm trap|unreachable/.test(r.stderr), show(label, r));
    assert.equal(r.stdout, '', show(label, r));
  }

  const ls = await run(['ls', '-A', H], { cwd: H });
  assert.equal(ls.status, 0, show('ls', ls));
  assert.ok(!/\.impeccable/.test(ls.stdout), show('ls after the account verbs', ls));

  for (const sub of ['connect', 'disconnect']) {
    const r = await imp(['loop', sub]);
    assert.equal(r.status, 1, show(`loop ${sub}`, r));
    assert.match(r.stderr, /^Impeccable Loop is only available on macOS\.$/m, show(`loop ${sub}`, r));
    assert.ok(!/Usage:|panicked|wasm trap|unreachable/.test(r.stderr), show(`loop ${sub}`, r));
    assert.equal(r.stdout, '', show(`loop ${sub}`, r));
  }

  const usage = await imp(['loop']);
  assert.equal(usage.status, 1, show('loop', usage));
  assert.match(usage.stderr, /^ +impeccable loop connect( \[--agent claude\|codex\] \[--json\])?$/m, show('loop', usage));
  assert.match(usage.stderr, /^ +impeccable loop disconnect$/m, show('loop', usage));
}
