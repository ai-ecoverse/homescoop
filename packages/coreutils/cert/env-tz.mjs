export default async function (ctx) {
  const { run, assert } = ctx;
  const sh = (cmd) => run(['bash', '-c', cmd], { cwd: '/tmp' });
  const out = async (cmd) => {
    const r = await sh(cmd);
    assert.equal(r.status, 0, `${cmd}: rc ${r.status} ${r.stderr}`);
    return r.stdout;
  };
  const clean = (await out('env -i FOO=1 env')).split('\n').filter(Boolean);
  for (const bogus of ['USER=web_user', 'LOGNAME=web_user', 'PATH=/', 'HOME=/home/web_user', 'PWD=/', '_=env']) {
    assert.ok(!clean.includes(bogus), `env -i FOO=1 env adds Emscripten's default ${bogus} (homescoop#612): ${JSON.stringify(clean)}`);
  }
  assert.ok(clean.includes('FOO=1'), JSON.stringify(clean));
  assert.ok(!clean.some((l) => l.startsWith('LANG=')), `env -i adds a LANG: ${JSON.stringify(clean)}`);
  const unset = await sh('env -u HOME printenv HOME');
  assert.deepEqual([unset.status, unset.stdout], [1, ''], `env -u HOME leaves no HOME: ${JSON.stringify(unset)}`);
  assert.ok((await out('env -i HOME=/root env')).split('\n').includes('HOME=/root'), 'env -i HOME=/root keeps that HOME');

  const rows = [
    ['date -u -d @0', 'Thu Jan  1 00:00:00 UTC 1970\n'],
    ['TZ=UTC0 date -d @0 +%Z%z', 'UTC+0000\n'],
    ['TZ=JST-9 date -d @0 +%H%Z', '09JST\n'],
    ['TZ=EST5EDT date -d @0 +%Z%z', 'EST-0500\n'],
    ['TZ=EST5EDT date -d @1720000000 +%Z%z', 'EDT-0400\n'],
    ["TZ='<+0330>-3:30' date -d @0 '+%Z %z %H:%M'", '+0330 +0330 03:30\n'],
    ["TZ=EST5EDT date -d '2026-07-01 12:00' +%s", '1782921600\n'],
    ["TZ=EST5EDT date -d '2026-01-15 12:00' +%s", '1768496400\n'],
    ["TZ=America/New_York date -d @0 '+%Z %z'", 'EST -0500\n'],
    ["TZ=Europe/Berlin date -d @1720000000 '+%z %H'", '+0200 11\n'],
    ["TZ=Nowhere/Bogus date -d @0 '+%Z %H'", 'UTC 00\n'],
    ['TZ= date -d @0 +%Z%H', 'UTC00\n'],
  ];
  for (const [cmd, want] of rows) assert.equal(await out(cmd), want, `${cmd} (homescoop#535)`);
  assert.equal(await out("TZ=EST5EDT touch -d '2026-01-15 10:00' /tmp/tzf && TZ=UTC0 ls -l --time-style=+%H:%M /tmp/tzf | cut -d' ' -f6"), '15:00\n', 'touch -d reads its time in TZ');
  console.log('env-tz: env -i and env -u leave only what they say (no web_user/PATH=/ defaults); date, touch and ls honour TZ: POSIX rules (EST5EDT, JST-9, UTC0, <+0330>-3:30) with US DST rules by default, IANA names (America/New_York, Europe/Berlin), an unknown or empty TZ is UTC, date -u is UTC');
}
