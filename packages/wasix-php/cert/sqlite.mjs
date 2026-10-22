/**
 * SQLite (3.54, built by build.sh) through the sqlite3 and pdo_sqlite
 * extensions: a database file, prepared statements, transactions and
 * rollback, FTS5, JSON and math functions, blobs, and a second process
 * reading what the first committed (rollback journal; WAL is compiled out).
 */
import { phpOk } from './lib/php.mjs';

export default async function (ctx) {
  const { assert, run } = ctx;
  await run(['rm', '-rf', '/tmp/sqlite-cert'], { cwd: '/tmp' });
  await run(['mkdir', '-p', '/tmp/sqlite-cert'], { cwd: '/tmp' });
  const out = await phpOk(ctx, `<?php
echo SQLite3::version()["versionString"], "|", PDO::getAvailableDrivers()[0], "\\n";
$db = new SQLite3("/tmp/sqlite-cert/a.db");
$db->exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, score REAL, data BLOB)");
$st = $db->prepare("INSERT INTO t (name, score, data) VALUES (:n, :s, :d)");
foreach (["alpha" => 1.5, "beta" => 2.25, "gamma" => 3.0] as $n => $s) { $st->bindValue(":n", $n); $st->bindValue(":s", $s); $st->bindValue(":d", "\\x00\\x01$n", SQLITE3_BLOB); $st->execute(); }
echo $db->querySingle("SELECT COUNT(*) FROM t"), "|", $db->querySingle("SELECT group_concat(name, ',') FROM t ORDER BY id"), "|", $db->querySingle("SELECT sum(score) FROM t"), "|", strlen($db->querySingle("SELECT data FROM t WHERE name = 'beta'")), "\\n";
$db->exec("BEGIN"); $db->exec("DELETE FROM t"); $db->exec("ROLLBACK"); echo $db->querySingle("SELECT COUNT(*) FROM t"), "\\n";
echo $db->querySingle("SELECT json_extract('{\\"a\\":[1,2,{\\"b\\":3}]}', '$.a[2].b')"), "|", $db->querySingle("SELECT round(sqrt(2), 6)"), "|", $db->querySingle("PRAGMA journal_mode"), "\\n";
$db->exec("CREATE VIRTUAL TABLE docs USING fts5(body)"); $db->exec("INSERT INTO docs VALUES ('php runs in the browser'), ('perl too'), ('so does ruby')");
echo $db->querySingle("SELECT body FROM docs WHERE docs MATCH 'browser'"), "\\n";
$db->close();
$pdo = new PDO("sqlite:/tmp/sqlite-cert/a.db", null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$q = $pdo->prepare("SELECT name, score FROM t WHERE score > ? ORDER BY score DESC"); $q->execute([2]);
echo json_encode($q->fetchAll(PDO::FETCH_KEY_PAIR)), "\\n";
$pdo->beginTransaction(); $pdo->exec("INSERT INTO t (name, score) VALUES ('delta', 4)"); $pdo->commit();
try { $pdo->exec("INSERT INTO nope VALUES (1)"); } catch (PDOException $e) { echo "PDOException ", $e->getCode(), ": ", $e->getMessage(), "\\n"; }
$mem = new PDO("sqlite::memory:"); $mem->exec("CREATE TABLE m (x)"); $mem->exec("WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < 100000) INSERT INTO m SELECT n FROM c");
echo $mem->query("SELECT sum(x) FROM m")->fetchColumn(), "\\n";
`);
  assert.equal(out, [
    '3.54.0|sqlite',
    '3|alpha,beta,gamma|6.75|6',
    '3',
    '3|1.414214|delete',
    'php runs in the browser',
    '{"gamma":3,"beta":2.25}',
    'PDOException HY000: SQLSTATE[HY000]: General error: 1 no such table: nope',
    '5000050000',
    '',
  ].join('\n'));
  // Another process sees the committed row.
  assert.equal((await run(['php', '-r', 'echo (new SQLite3("/tmp/sqlite-cert/a.db", SQLITE3_OPEN_READONLY))->querySingle("SELECT name FROM t WHERE score = 4"), "\\n";'], { cwd: '/tmp' })).stdout, 'delta\n');
}
