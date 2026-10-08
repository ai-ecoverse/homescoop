/**
 * GNU which checklist.
 * Resolves slicc.commands on PATH (/usr/bin, /bin) and supports -a.
 */
export default async function (ctx) {
  const { run, assert } = ctx;

  const ls = await run(['which', 'ls'], { cwd: '/home' });
  assert.equal(ls.status, 0, `which ls stderr=${ls.stderr}`);
  assert.match(ls.stdout.trim(), /^\/(usr\/)?bin\/ls$/, `which ls → ${JSON.stringify(ls.stdout)}`);

  // Two providers on PATH: earlier dir wins for plain which; -a lists both.
  const setup = await run(
    [
      'bash',
      '-c',
      [
        'mkdir -p /home/which-a /home/which-b',
        "printf '%s\\n' '#!/bin/sh' 'echo provider-a' > /home/which-a/dupcmd",
        "printf '%s\\n' '#!/bin/sh' 'echo provider-b' > /home/which-b/dupcmd",
        'chmod +x /home/which-a/dupcmd /home/which-b/dupcmd',
      ].join(' && '),
    ],
    { cwd: '/home' },
  );
  assert.equal(setup.status, 0, `setup stderr=${setup.stderr}`);

  const pathEnv = {
    PATH: '/home/which-a:/home/which-b:/usr/bin:/bin',
  };

  const one = await run(['which', 'dupcmd'], { cwd: '/home', env: pathEnv });
  assert.equal(one.status, 0, `which dupcmd stderr=${one.stderr}`);
  assert.equal(one.stdout.trim(), '/home/which-a/dupcmd');

  const all = await run(['which', '-a', 'dupcmd'], { cwd: '/home', env: pathEnv });
  assert.equal(all.status, 0, `which -a stderr=${all.stderr}`);
  const lines = all.stdout.trim().split('\n');
  assert.deepEqual(
    lines,
    ['/home/which-a/dupcmd', '/home/which-b/dupcmd'],
    `which -a stdout=${JSON.stringify(all.stdout)}`,
  );

  const miss = await run(['which', 'homescoop-no-such-cmd-zz'], { cwd: '/home' });
  assert.equal(miss.status, 1, `missing should be 1, got ${miss.status} stderr=${miss.stderr}`);

  const self = await run(['which', 'which'], { cwd: '/home' });
  assert.equal(self.status, 0, `which which stderr=${self.stderr}`);
  assert.match(self.stdout.trim(), /^\/(usr\/)?bin\/which$/, `which which → ${JSON.stringify(self.stdout)}`);
}
