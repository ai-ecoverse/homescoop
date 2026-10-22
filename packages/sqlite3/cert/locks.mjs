const HOLD_PY = `import sqlite3, sys, time
mode, row = sys.argv[1], sys.argv[2]
c = sqlite3.connect('l.db', isolation_level=None, timeout=0)
if mode == 'write':
    c.execute('begin immediate')
    c.execute('insert into t values (?)', (row,))
else:
    c.execute('select count(*) from t').fetchall()
open('held', 'w').close()
time.sleep(8)
if mode == 'write':
    c.execute('commit')
print('a-commit', row)
`;

const TRY_PY = `import sqlite3, sys
c = sqlite3.connect('l.db', isolation_level=None, timeout=0)
try:
    c.execute('insert into t values (?)', (sys.argv[1],))
except sqlite3.OperationalError as e:
    print('py-error:', e)
    sys.exit(1)
print('py-inserted', sys.argv[1])
`;

const RACE = String.raw`
a=$1; b=$2
rm -f held
bash -c "$a" > a.log 2>&1 &
pid=$!
for i in $(seq 300); do
  [ -e held ] && break
  kill -0 $pid 2>/dev/null || break
  sleep 0.1
done
[ -e held ] && echo a-held || echo a-never-held
kill -0 $pid 2>/dev/null && echo a-running || echo a-done-early
bash -c "$b" > b.log 2>&1; echo "b=$?"
kill -0 $pid 2>/dev/null && echo a-still-running || echo a-ended-before-b
wait $pid; echo "a=$?"
echo '--- a'; cat a.log; echo '--- b'; cat b.log
`;

const cliHold = (sql) => `{ echo "${sql}"; echo '.once held'; echo 'select 1;'; sleep 8; echo 'commit;'; } | sqlite3 l.db`;

export default async function locks(ctx) {
  const { assert } = ctx;
  const cwd = '/home/lk';
  await ctx.write('/home/lk/hold.py', HOLD_PY);
  await ctx.write('/home/lk/try.py', TRY_PY);
  await ctx.write('/home/lk/race.sh', RACE);
  const sh = (script) => ctx.run(['bash', '-c', script], { cwd });
  const ok = async (script) => {
    const r = await sh(script);
    assert.equal(r.status, 0, `${script}: rc ${r.status}\n${r.stdout}${r.stderr}`);
    return r.stdout;
  };
  const race = async (label, a, b, bRc) => {
    const r = await sh(`bash race.sh '${a.replace(/'/g, `'\\''`)}' '${b.replace(/'/g, `'\\''`)}'`);
    assert.equal(r.status, 0, `${label}: race.sh rc ${r.status}\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, new RegExp(`^a-held\\na-running\\nb=${bRc}\\na-still-running\\na=0\\n`), `${label}: A held its lock through B, B rc ${bRc}, A rc 0:\n${r.stdout}`);
    return r.stdout;
  };
  const rows = async () => (await ok("sqlite3 l.db 'select group_concat(name, \",\") from (select name from t order by rowid);'")).trim();

  await ok("sqlite3 l.db 'create table t(name text);'");
  assert.match(await ok("python3 -c 'import sqlite3; print(sqlite3.sqlite_version)'"), /^3\.\d+\.\d+\n$/, 'wasix-python has its sqlite3 module');

  const a = await race('the CLI holds, python writes', cliHold("begin immediate; insert into t values ('cli-held');"), 'python3 try.py py-try', 1);
  assert.match(a, /py-error: database is locked/, `python's insert gets 'database is locked' while the CLI holds the write lock:\n${a}`);
  assert.equal(await rows(), 'cli-held', "the CLI's commit keeps its row and python's insert left none");

  const b = await race('python holds, the CLI writes', 'python3 hold.py write py-held', "sqlite3 l.db \"insert into t values ('cli-try');\"", 1);
  assert.match(b, /database is locked/, `the CLI's insert gets 'database is locked' while python holds the write lock:\n${b}`);
  assert.match(b, /a-commit py-held/, `python's commit succeeds:\n${b}`);
  assert.equal(await rows(), 'cli-held,py-held');

  const c = await race('the CLI holds, the CLI writes', cliHold("begin immediate; insert into t values ('cli-held2');"), "sqlite3 l.db \"insert into t values ('cli-try2');\"", 1);
  assert.match(c, /database is locked/, `a second CLI's insert gets 'database is locked':\n${c}`);
  assert.equal(await rows(), 'cli-held,py-held,cli-held2');

  const d = await race('an idle CLI, python writes', `{ echo 'select count(*) from t;'; echo '.once held'; echo 'select 1;'; sleep 8; echo 'select count(*) from t;'; } | sqlite3 l.db`, 'python3 try.py idle-py', 0);
  assert.match(d, /py-inserted idle-py/, `an idle reader lets python's write through:\n${d}`);
  assert.match(d, /--- a\n3\n4\n/, `the idle CLI then sees python's row:\n${d}`);

  const e = await race('an idle python, the CLI writes', 'python3 hold.py read -', "sqlite3 l.db \"insert into t values ('idle-cli');\"", 0);
  assert.match(e, /--- b\n$/, `the CLI's insert goes through silently:\n${e}`);
  assert.equal(await rows(), 'cli-held,py-held,cli-held2,idle-py,idle-cli', 'every committed row is kept');
}
