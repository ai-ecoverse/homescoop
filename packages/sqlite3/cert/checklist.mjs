export default async function sqlite3(ctx) {
  const { assert } = ctx;
  const cwd = '/home/sq';
  await ctx.write('/home/sq/.keep', '');
  const run = (argv, opts = {}) => ctx.run(argv, { cwd, ...opts });
  const ok = async (argv, opts) => {
    const r = await run(argv, opts);
    assert.equal(r.status, 0, `${argv.join(' ')}: rc ${r.status}\n${r.stderr}`);
    assert.equal(r.stderr, '', `${argv.join(' ')}: stderr ${r.stderr}`);
    return r.stdout;
  };

  assert.match(await ok(['sqlite3', '-version']), /^3\.54\.0 \d{4}-\d\d-\d\d /);
  assert.equal(await ok(['sqlite3', ':memory:', 'select sqlite_version();']), '3.54.0\n');

  await ok(['sqlite3', 't.db', 'create table t(id integer primary key, name text, n real); insert into t(name, n) values (\'a\', 1.5), (\'b\', 2.5), (\'c\', 4);']);
  assert.equal(await ok(['sqlite3', 't.db', 'select count(*), sum(n) from t;']), '3|8.0\n', 'a second process reads what the first wrote');
  assert.equal(await ok(['sqlite3', '-csv', '-header', 't.db', 'select name, n from t order by id;']), 'name,n\r\na,1.5\r\nb,2.5\r\nc,4.0\r\n', 'CSV rows end in CRLF (RFC 4180, as native sqlite3)');
  assert.equal(await ok(['sqlite3', '-json', 't.db', 'select name from t where n > 2;']), '[{"name":"b"},\n{"name":"c"}]\n');

  const script = '.mode list\n.separator ,\ncreate table u(x);\ninsert into u values (1),(2),(3);\nselect group_concat(x) from u;\nselect sum(x) over () from u limit 1;\n';
  assert.equal(await ok(['sqlite3', 's.db'], { stdin: script }), '1,2,3\n6\n', 'script on stdin');

  await ctx.write('/home/sq/in.csv', 'k,v\nx,1\ny,2\n');
  await ok(['sqlite3', 'i.db', '.import --csv in.csv kv']);
  assert.equal(await ok(['sqlite3', 'i.db', 'select group_concat(k || v, \' \') from kv;']), 'x1 y2\n', '.import --csv');

  assert.equal(
    await ok(['sqlite3', ':memory:', 'create virtual table d using fts5(body); insert into d values (\'the quick brown fox\'), (\'lazy dog\'); select body from d where d match \'quick\';']),
    'the quick brown fox\n',
    'FTS5',
  );
  assert.equal(await ok(['sqlite3', ':memory:', 'create virtual table r using rtree(id, x0, x1); insert into r values (1, 0, 10); select id from r where x0 <= 5 and x1 >= 5;']), '1\n', 'RTREE');
  assert.equal(await ok(['sqlite3', ':memory:', 'select sqrt(16), pow(2, 10);']), '4.0|1024.0\n', 'math functions');
  assert.equal(await ok(['sqlite3', ':memory:', 'select json_extract(\'{"a":[1,2,3]}\', \'$.a[2]\');']), '3\n', 'JSON');

  assert.equal(await ok(['sqlite3', 'w.db', 'pragma journal_mode=wal; create table a(x); insert into a values (1), (2); select count(*) from a;']), 'delete\n2\n', 'journal_mode=WAL keeps the rollback journal (SQLITE_OMIT_WAL) and writes go through');
  assert.equal(await ok(['sqlite3', 'w.db', 'insert into a values (3); select sum(x) from a; pragma journal_mode;']), '6\ndelete\n', 'the file reopens after the WAL request');
  const dump = await ok(['sqlite3', 'w.db', '.dump']);
  assert.match(dump, /CREATE TABLE a\(x\);/);
  assert.equal(await ok(['sqlite3', 'w2.db'], { stdin: dump }), '', '.dump replays into a new database');
  assert.equal(await ok(['sqlite3', 'w2.db', 'select group_concat(x) from a;']), '1,2,3\n', '.dump round trip');

  await ctx.write('/home/sq/bad.db', 'this is not an sqlite database, just text that is long enough to have a header');
  const bad = await run(['sqlite3', 'bad.db', 'select 1 from sqlite_master;']);
  assert.equal(bad.status, 1, `bad.db: rc ${bad.status}`);
  assert.match(bad.stderr, /file is not a database/);
  const syn = await run(['sqlite3', ':memory:', 'selec 1;']);
  assert.equal(syn.status, 1);
  assert.match(syn.stderr, /syntax error/);
  const ext = await run(['sqlite3', ':memory:', '.load foo']);
  assert.notEqual(ext.status, 0, '.load is compiled out');
}
