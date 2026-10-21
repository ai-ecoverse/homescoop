export default async function envI(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: 'builder' });
  const run = (argv) => ctx.run(argv, { cwd: '/home/builder', user: 'builder' });
  const vars = (out) => out.split('\n').filter(Boolean).map((l) => l.slice(0, l.indexOf('=')));
  const empty = await run(['env', '-i', '/usr/bin/cmake', '-E', 'environment']);
  assert.equal(empty.status, 0, `env -i cmake -E environment: ${empty.stdout}${empty.stderr}`);
  assert.doesNotMatch(empty.stdout, /web_user/, `env -i cmake: no Emscripten web_user placeholders (homescoop#1501): ${empty.stdout}`);
  assert.doesNotMatch(empty.stdout, /^PATH=\/$/m, `env -i cmake: no PATH=/ (homescoop#1501): ${empty.stdout}`);
  for (const n of ['HOME', 'USER', 'LOGNAME', 'PATH', 'LANG']) assert.ok(!vars(empty.stdout).includes(n), `env -i cmake has no ${n} (homescoop#1501): ${empty.stdout}`);
  const one = await run(['env', '-i', 'ONLY=this', '/usr/bin/cmake', '-E', 'environment']);
  assert.equal(one.status, 0, one.stderr);
  assert.match(one.stdout, /^ONLY=this$/m, `a variable the caller passes reaches cmake: ${one.stdout}`);
  assert.doesNotMatch(one.stdout, /web_user/, one.stdout);
  const user = await run(['cmake', '-E', 'environment']);
  assert.equal(user.status, 0, user.stderr);
  assert.doesNotMatch(user.stdout, /web_user/, `cmake as builder sees the kernel's environment, not web_user: ${user.stdout}`);
  console.log(`env-i: env -i cmake -E environment gives [${vars(empty.stdout).join(' ')}], no web_user, PATH=/, HOME, USER, LOGNAME or LANG; env -i ONLY=this passes ONLY; cmake as builder has no web_user`);
}
