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
  const abbr = [
    ['Asia/Tokyo', 0, 'JST +0900'],
    ['Europe/London', 1735000000, 'GMT +0000'],
    ['Europe/London', 1720000000, 'BST +0100'],
    ['Europe/Dublin', 1735000000, 'GMT +0000'],
    ['Europe/Dublin', 1720000000, 'IST +0100'],
    ['Europe/Berlin', 1735000000, 'CET +0100'],
    ['Europe/Berlin', 1720000000, 'CEST +0200'],
    ['Europe/Moscow', 1720000000, 'MSK +0300'],
    ['Australia/Sydney', 1720000000, 'AEST +1000'],
    ['Australia/Sydney', 1735000000, 'AEDT +1100'],
    ['Pacific/Auckland', 1735000000, 'NZDT +1300'],
    ['Asia/Kolkata', 1720000000, 'IST +0530'],
    ['Asia/Shanghai', 1720000000, 'CST +0800'],
    ['Africa/Johannesburg', 1720000000, 'SAST +0200'],
    ['Africa/Abidjan', 0, 'GMT +0000'],
    ['America/Adak', 1720000000, 'HDT -0900'],
    ['America/St_Johns', 1735000000, 'NST -0330'],
    ['America/Los_Angeles', 1720000000, 'PDT -0700'],
    ['Etc/GMT', 0, 'GMT +0000'],
    ['UTC', 0, 'UTC +0000'],
    ['Asia/Dubai', 0, '+04 +0400'],
    ['Asia/Kathmandu', 1720000000, '+0545 +0545'],
    ['America/Sao_Paulo', 1720000000, '-03 -0300'],
    ['Etc/GMT-9', 0, '+09 +0900'],
  ];
  for (const [zone, t, want] of abbr) {
    const cmd = `TZ=${zone} date -d @${t} '+%Z %z'`;
    assert.equal(await out(cmd), `${want}\n`, `${cmd}: %Z is the tz database's abbreviation, as GNU date with glibc prints it, and a number only where the database has none (homescoop#1417)`);
  }
  assert.equal(await out("TZ=EST5EDT touch -d '2026-01-15 10:00' /tmp/tzf && TZ=UTC0 ls -l --time-style=+%H:%M /tmp/tzf | cut -d' ' -f6"), '15:00\n', 'touch -d reads its time in TZ');
  console.log('env-tz: env -i and env -u leave only what they say (no web_user/PATH=/ defaults); date, touch and ls honour TZ: POSIX rules (EST5EDT, JST-9, UTC0, <+0330>-3:30) with US DST rules by default, IANA names (America/New_York, Europe/Berlin) with the tz database abbreviations (JST, GMT/BST, IST, CET/CEST, AEST/AEDT, +04 where it has none), an unknown or empty TZ is UTC, date -u is UTC');
}
