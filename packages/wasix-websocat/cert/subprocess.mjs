export default async function subprocess(ctx) {
  const { assert } = ctx;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const run = (argv, stdin) => Promise.race([
    ctx.run(argv, { cwd: '/home', stdin }),
    sleep(20000).then(() => ({ status: 'no exit within 20 s', stdout: '', stderr: '' })),
  ]);
  for (const argv of [
    ['websocat', '-s', '18110', 'cmd:tr a-z A-Z'],
    ['websocat', 'ws-l:127.0.0.1:18111', 'exec:cat'],
    ['websocat', '-b', 'ws://127.0.0.1:18112/', 'sh-c:cat'],
  ]) {
    const r = await run(argv, 'hello\n');
    const out = `${r.stdout}${r.stderr}`;
    assert.notEqual(r.status, 0, `${argv.join(' ')} must fail: rc ${r.status}`);
    assert.equal(typeof r.status, 'number', `${argv.join(' ')}: ${r.status}`);
    assert.match(out, /exec:, cmd: and sh-c: are not supported on WASIX/, `${argv.join(' ')}: ${out}`);
    assert.doesNotMatch(out, /panicked at/, `${argv.join(' ')} must not panic: ${out}`);
  }
  const listen = await run(['websocat', '--exec-after-listen', 'echo hi', '-s', '18113', 'mirror:']);
  const lout = `${listen.stdout}${listen.stderr}`;
  assert.equal(typeof listen.status, 'number', `--exec-after-listen: ${listen.status}`);
  assert.notEqual(listen.status, 0, `--exec-after-listen must fail: rc ${listen.status}`);
  assert.match(lout, /--exec-after-listen is not supported on WASIX/);
  assert.doesNotMatch(lout, /panicked at|^hi$/m, `--exec-after-listen spawned or panicked: ${lout}`);
  for (const [name, script] of [
    ['execute()', 'let c = subprocess_new("echo"); c.arg("x"); let ch = c.execute(); sleep_ms(500)\n'],
    ['execute_for_status()', 'let c = subprocess_new("echo"); c.execute_for_status(|code| { print_stdout(str(code)) })\n'],
    ['system()', 'system("echo y")\n'],
  ]) {
    await ctx.write(`/home/s-${name.replace(/\W/g, '')}.rhai`, script);
    const r = await run(['websocat', '-x', `s-${name.replace(/\W/g, '')}.rhai`]);
    const out = `${r.stdout}${r.stderr}`;
    assert.equal(typeof r.status, 'number', `-x ${name}: ${r.status}`);
    assert.notEqual(r.status, 0, `-x ${name} must fail: rc ${r.status}`);
    assert.notEqual(r.status, 134, `-x ${name}: no abort`);
    assert.match(out, /subprocesses are not supported on WASIX/, `-x ${name}: ${out}`);
    assert.doesNotMatch(out, /panicked at/, `-x ${name} must not panic: ${out}`);
  }
}
