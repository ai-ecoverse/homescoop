/**
 * Failures exit non-zero and log to stderr (4.0.0-alpha3-7, 0005), as cone
 * under users enforce:
 * - homescoop#696: a second `websocat -s <port>` on a port a server holds
 *   exits 15 ("Address in use"); upstream v4 exited 0.
 * - homescoop#1023: readfile: of a missing file and writefile: into a
 *   read-only directory exit 16; upstream v4 exited 0.
 * - homescoop#868: the log lines go to stderr. A refused connect (rc 14)
 *   leaves stdout empty, so `websocat … > out` or `| jq` carries no log line.
 */
export default async function (ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: 'cone' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const run = (script) => ctx.run(['bash', '-c', script], { cwd: '/home/cone', user: 'cone' });
  const out = (r) => `rc=${r.status}\n--- stdout\n${r.stdout.slice(-800)}\n--- stderr\n${r.stderr.slice(-800)}`;
  const server = ctx.run(['websocat', '--global-timeout-ms', '60000', '--global-timeout-force-exit', '-s', '18130', 'mirror:'], { cwd: '/home/cone', user: 'cone' }).catch((e) => ({ error: String(e) }));
  await sleep(1500);

  const busy = await run('websocat -s 18130 mirror:');
  assert.equal(busy.status, 15, `#696 a listener that can't bind exits 15: ${out(busy)}`);
  assert.match(busy.stderr, /Address in use/, `#696/#868 the bind error is on stderr: ${out(busy)}`);
  assert.equal(busy.stdout, '', `#868 nothing on stdout: ${out(busy)}`);

  const missing = await run('websocat -b readfile:nope.bin ws://127.0.0.1:18130/');
  assert.equal(missing.status, 16, `#1023 readfile: of a missing file exits 16: ${out(missing)}`);
  assert.match(missing.stderr, /Failed to open file/, `#1023 the open error is on stderr: ${out(missing)}`);
  assert.equal(missing.stdout, '', `#868 nothing on stdout: ${out(missing)}`);

  const ro = await run('mkdir -p ro && chmod 555 ro && echo x | websocat ws://127.0.0.1:18130/ writefile:ro/x.txt');
  assert.equal(ro.status, 16, `#1023 writefile: into a read-only directory exits 16: ${out(ro)}`);
  assert.match(ro.stderr, /Permission denied/, `#1023 ${out(ro)}`);

  const refused = await run('echo x | websocat ws://127.0.0.1:18131/');
  assert.equal(refused.status, 14, `a refused connect still exits 14: ${out(refused)}`);
  assert.match(refused.stderr, /Connection refused/, `#868 the connect error is on stderr: ${out(refused)}`);
  assert.equal(refused.stdout, '', `#868 stdout carries no log line: ${out(refused)}`);

  const ok = await run('echo hello | websocat ws://127.0.0.1:18130/');
  assert.equal(ok.status, 0, `a good round trip still exits 0: ${out(ok)}`);
  assert.equal(ok.stdout, 'hello\n', `and its data is all of stdout: ${out(ok)}`);
  const done = await Promise.race([server, sleep(100).then(() => null)]);
  assert.equal(done, null, 'the first server is still serving');
  console.log('exit-codes: bind failure 15, file open failure 16, connect 14, logs on stderr');
}
