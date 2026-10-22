export default async function users(ctx) {
  const { assert, addUser } = ctx;
  const alice = await addUser({ name: 'alice' });
  const bob = await addUser({ name: 'bob' });
  assert.notEqual(alice.uid, bob.uid, JSON.stringify({ alice, bob }));
  const as = (user, argv) => ctx.run(argv, { user, cwd: `/home/${user}` });

  const made = await as('alice', ['sqlite3', '/home/alice/a.db', "create table t(x); insert into t values (1), (2), (3); select sum(x) from t;"]);
  assert.equal(made.status, 0, `alice creates her database: ${made.stderr}`);
  assert.equal(made.stdout, '6\n');

  for (const argv of [['sqlite3', '/home/alice/a.db', 'select sum(x) from t;'], ['sqlite3', '-readonly', '/home/alice/a.db', 'select sum(x) from t;']]) {
    const r = await as('bob', argv);
    assert.equal(r.status, 1, `bob: ${argv.join(' ')}: rc ${r.status}\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /unable to open database file/, `bob is refused alice's database: ${r.stderr}`);
    assert.equal(r.stdout, '');
  }

  const again = await as('alice', ['sqlite3', '/home/alice/a.db', 'insert into t values (4); select count(*), sum(x) from t;']);
  assert.equal(again.status, 0, `alice reopens her database: ${again.stderr}`);
  assert.equal(again.stdout, '4|10\n', "alice's database is intact after bob's attempts");
}
