const probe = `export default async function (ctx) {
  const lines = [];
  for (const script of JSON.parse(ctx.argv[1])) {
    const argv = ['bash', '-c', script];
    const r = ctx.sync.run({ argv });
    const c = await ctx.spawn({ argv, stdin: 'null', stdout: 'null', stderr: 'null' });
    const w = await c.wait();
    lines.push(JSON.stringify({ script, run: [r.status, r.signal ?? null], wait: [w.status, w.signal ?? null], out: new TextDecoder().decode(r.stdout).trim() }));
  }
  ctx.sync.write(1, lines.join('\\n') + '\\n');
}
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/node_modules/@cert/selfkill-probe/package.json', JSON.stringify({ name: '@cert/selfkill-probe', version: '0.0.0', slicc: { commands: { 'selfkill-probe': { abi: 'js', module: 'probe.mjs' } } } }));
  await write('/node_modules/@cert/selfkill-probe/probe.mjs', probe);
  const scripts = {
    term: 'kill -TERM $$; echo after',
    kill: 'kill -KILL $$; echo after',
    int: 'kill -INT $$; echo after',
    exit: 'exit 143',
    trap: 'trap "echo t" TERM; kill -TERM $$; echo after',
    ignore: 'trap "" TERM; kill -TERM $$; echo after',
  };
  const r = await run(['selfkill-probe', JSON.stringify(Object.values(scripts))], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const got = Object.fromEntries(r.stdout.trim().split('\n').map((l) => JSON.parse(l)).map((o) => [Object.keys(scripts).find((k) => scripts[k] === o.script), o]));
  for (const [name, sig] of [['term', 15], ['kill', 9], ['int', 2]]) {
    assert.deepEqual(got[name].run, [null, sig], `${scripts[name]}: sync.run ${JSON.stringify(got[name])}`);
    assert.deepEqual(got[name].wait, [128 + sig, sig], `${scripts[name]}: wait ${JSON.stringify(got[name])}`);
    assert.equal(got[name].out, '', `${scripts[name]} ran on: ${got[name].out}`);
  }
  assert.deepEqual(got.exit.run, [143, null], `exit 143: ${JSON.stringify(got.exit)}`);
  assert.deepEqual(got.exit.wait, [143, null], `exit 143: ${JSON.stringify(got.exit)}`);
  assert.deepEqual(got.trap.run, [0, null], JSON.stringify(got.trap));
  assert.equal(got.trap.out, 't\nafter');
  assert.deepEqual(got.ignore.run, [0, null], JSON.stringify(got.ignore));
  assert.equal(got.ignore.out, 'after');
  const inherited = await run(
    [
      'bash',
      '-c',
      `trap '' TERM HUP; bash -c 'kill -TERM $$; echo t1'; echo rc=$?; bash -c 'trap - TERM; kill -TERM $$; echo t2'; echo rc=$?; bash -c 'trap - HUP; kill -HUP $$; echo h1'; echo rc=$?`,
    ],
    { cwd: '/tmp' },
  );
  assert.equal(inherited.status, 0, `${inherited.stdout}${inherited.stderr}`);
  assert.equal(inherited.stdout, 't1\nrc=0\nt2\nrc=0\nh1\nrc=0\n', `a signal the parent ignores stays ignored in a child bash, trap - or not, and kill -SIG $$ returns (homescoop#1070): ${JSON.stringify(inherited.stdout)}`);
  console.log('selfkill: kill -TERM/-KILL/-INT $$ end bash by the signal (sync.run status null + signal, wait 128+n + signal); exit 143 is an exit; a trapped or ignored TERM stays in bash; under an inherited TERM/HUP ignore a child bash survives kill -TERM/-HUP $$, also after trap -');
}
