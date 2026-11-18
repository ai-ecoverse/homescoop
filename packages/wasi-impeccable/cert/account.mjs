export default async function ({ run, write, assert }) {
  const H = '/home/impaccount';
  await write(`${H.slice(1)}/.keep`, '');
  const show = (label, r) => `${label} → rc=${r.status}\n--- stdout\n${r.stdout.slice(0, 600)}\n--- stderr\n${r.stderr.slice(0, 600)}`;

  for (const verb of ['login', 'logout', 'whoami', 'health', 'pro-refresh']) {
    const r = await run(['impeccable', verb], { cwd: H, env: { HOME: H } });
    assert.equal(r.status, 1, show(verb, r));
    assert.match(
      r.stderr,
      new RegExp(`^impeccable ${verb}: needs Impeccable account sign-in; not available in this build yet$`, 'm'),
      show(verb, r),
    );
    assert.ok(!/Unknown command|panicked|wasm trap|unreachable/.test(r.stderr), show(verb, r));
    assert.equal(r.stdout, '', show(verb, r));
  }

  const loop = await run(['impeccable', 'loop', 'install', '--no-open'], { cwd: H, env: { HOME: H } });
  assert.equal(loop.status, 1, show('loop install', loop));
  assert.match(loop.stderr, /^Impeccable Loop is only available on macOS\.$/m, show('loop install', loop));
  assert.ok(!/Unknown command|panicked|wasm trap/.test(loop.stderr), show('loop install', loop));
  const ls = await run(['ls', '-A', H], { cwd: H });
  assert.equal(ls.status, 0, show('ls', ls));
  assert.ok(!/Applications|\.impeccable-loop-/.test(ls.stdout), show('ls after loop install', ls));

  const usage = await run(['impeccable', 'loop'], { cwd: H, env: { HOME: H } });
  assert.equal(usage.status, 1, show('loop', usage));
  assert.match(usage.stderr, /^Usage: impeccable loop install/m, show('loop', usage));
}
