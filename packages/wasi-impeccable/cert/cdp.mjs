export default async function ({ run, assert }) {
  const cdp = await run(['impeccable', 'detect', '--cdp', '9222'], { cwd: '/home' });
  assert.equal(cdp.status, 1, `detect --cdp 9222 status=${cdp.status} stderr=${cdp.stderr}`);
  assert.match(
    cdp.stderr,
    /^Error: --cdp scans need a browser; not available in this build yet$/m,
    `detect --cdp 9222 stderr=${JSON.stringify(cdp.stderr)}`,
  );
  assert.ok(!/cannot attach|cannot access|puppeteer/i.test(cdp.stderr), `detect --cdp 9222 stderr=${JSON.stringify(cdp.stderr)}`);
  assert.equal(cdp.stdout, '', `detect --cdp 9222 stdout=${JSON.stringify(cdp.stdout)}`);

  const remote = await run(['impeccable', 'detect', '--cdp', '10.0.0.5:9222'], { cwd: '/home' });
  assert.equal(remote.status, 1, `detect --cdp 10.0.0.5:9222 status=${remote.status}`);
  assert.match(
    remote.stderr,
    /--cdp only attaches to a DevTools port on this machine/,
    `detect --cdp 10.0.0.5:9222 stderr=${JSON.stringify(remote.stderr)}`,
  );
}
