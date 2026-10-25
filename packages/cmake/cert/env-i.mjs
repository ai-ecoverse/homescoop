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
  await ctx.write('/home/builder/who.cmake', 'file(REAL_PATH "~" t EXPAND_TILDE)\nmessage(STATUS "home=$ENV{HOME}|user=$ENV{USER}|path=$ENV{PATH}|tilde=${t}")\n');
  const path = await run(['printenv', 'PATH']);
  assert.equal(path.status, 0, path.stderr);
  const who = await run(['cmake', '-P', 'who.cmake']);
  assert.equal(who.status, 0, `cmake -P who.cmake: ${who.stdout}${who.stderr}`);
  assert.equal((who.stdout.match(/-- (home=.*)\n/) || [])[1], `home=/home/builder|user=builder|path=${path.stdout.trim()}|tilde=/home/builder`, `cmake as builder gets the kernel's HOME, USER and PATH, and ~ is builder's home (homescoop#1281): ${who.stdout}`);
  console.log(`env-i: env -i cmake -E environment gives [${vars(empty.stdout).join(' ')}], no web_user, PATH=/, HOME, USER, LOGNAME or LANG; env -i ONLY=this passes ONLY; cmake as builder has no web_user, and HOME=/home/builder, USER=builder, the kernel's PATH and ~ = /home/builder`);
}
