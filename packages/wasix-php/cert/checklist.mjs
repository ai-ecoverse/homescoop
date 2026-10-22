/**
 * wasix-php checklist: the version and build, the extension set, scripts
 * from a file, -r and stdin, exit codes and errors, and the core extensions
 * doing real work (json, pcre, mbstring, iconv, hash, openssl, zlib, bcmath,
 * date, random, ctype, filter, tokenizer, calendar, posix, session).
 */
import { php, phpOk } from './lib/php.mjs';

const MODULES = [
  'bcmath', 'calendar', 'Core', 'ctype', 'date', 'dom', 'exif', 'fileinfo', 'filter', 'hash', 'iconv', 'json',
  'lexbor', 'libxml', 'mbstring', 'openssl', 'pcntl', 'pcre', 'PDO', 'pdo_sqlite', 'Phar', 'posix', 'random',
  'Reflection', 'session', 'SimpleXML', 'SPL', 'sqlite3', 'standard', 'tokenizer', 'uri', 'xml', 'xmlreader',
  'xmlwriter', 'Zend OPcache', 'zlib',
];

export default async function (ctx) {
  const { run, assert } = ctx;

  const v = await run(['php', '-v'], { cwd: '/tmp' });
  assert.equal(v.status, 0, v.stderr);
  // "built:" is the release tarball's date (SOURCE_DATE_EPOCH), not the build's.
  assert.match(v.stdout, /^PHP 8\.5\.12 \(cli\) \(built: Oct 19 2026 17:02:46\) \(NTS\)\nCopyright \(c\) The PHP Group\nBuilt by homescoop \(https:\/\/github\.com\/ai-ecoverse\/homescoop\)\n/, v.stdout);
  assert.match(v.stdout, /Zend Engine v4\.5\.12/);
  assert.match(v.stdout, /with Zend OPcache v8\.5\.12/);

  const m = await run(['php', '-m'], { cwd: '/tmp' });
  assert.equal(m.status, 0, m.stderr);
  const mods = m.stdout.split('[Zend Modules]')[0].split('\n').filter((l) => l && !l.startsWith('['));
  assert.deepEqual([...mods].sort(), [...MODULES].sort(), `php -m: ${mods.join(', ')}`);

  assert.equal(await phpOk(ctx, '<?php echo PHP_VERSION, "|", PHP_OS, "|", PHP_OS_FAMILY, "|", PHP_INT_SIZE, "|", PHP_INT_MAX, "|", PHP_EOL === "\\n" ? "lf" : "?", "\\n";'),
    '8.5.12|WASI|Unknown|4|2147483647|lf\n');
  // php_uname() is the kernel's uname(); PHP_BINARY is the command's /usr/bin entry.
  assert.match(await phpOk(ctx, '<?php echo php_uname("s"), "|", php_uname("m"), "|", PHP_BINARY, "\\n";'), /^wasi\|wasm32\|\/usr\/bin\/php\n$/);
  const ini = await run(['php', '--ini'], { cwd: '/tmp' });
  assert.equal(ini.status, 0, ini.stderr);
  assert.match(ini.stdout, /Configuration File \(php\.ini\) Path: "\/etc\/php"/);
  assert.match(ini.stdout, /Scan for additional \.ini files in: "\/etc\/php\/conf\.d"/);
  // Configure Command names no build machine (build.sh scrubs --build and pkg-config paths).
  const info = await run(['php', '-i'], { cwd: '/tmp' });
  assert.equal(info.status, 0, info.stderr);
  assert.match(info.stdout, /^Build System => wasm32-wasix \(homescoop wasix-php/m);
  assert.match(info.stdout, /^Configure Command =>  '\.\/configure'  '--host=wasm32-unknown-wasi' '--prefix=\/usr'/m);
  assert.doesNotMatch(info.stdout, /--build=|PKG_CONFIG_PATH|\/home\/runner|\/Users\//);

  // -r, a script file with arguments, stdin.
  assert.equal((await run(['php', '-r', 'echo 6 * 7, PHP_EOL;'], { cwd: '/tmp' })).stdout, '42\n');
  assert.equal(await phpOk(ctx, '<?php echo $argc, " ", implode(",", array_slice($argv, 1)), "\\n";', { args: ['a', 'b c'] }), '3 a,b c\n');
  const stdin = await run(['php'], { cwd: '/tmp', stdin: '<?php echo strtoupper("from stdin"), "\\n";\n' });
  assert.equal(stdin.stdout, 'FROM STDIN\n', stdin.stderr);
  const filter = await run(['php', '-R', 'echo strrev($argn), "\\n";'], { cwd: '/tmp', stdin: 'abc\nxyz\n' });
  assert.equal(filter.stdout, 'cba\nzyx\n', filter.stderr);
  const lint = await run(['php', '-l', '-r', 'echo 1;'], { cwd: '/tmp' });
  assert.notEqual(lint.status, 0, 'php -l -r is an error, as upstream');

  // Exit codes and errors.
  assert.equal((await php(ctx, '<?php exit(7);')).status, 7);
  const fatal = await php(ctx, '<?php function f() { undefined_fn(); } f();');
  assert.equal(fatal.status, 255);
  assert.match(fatal.stdout, /PHP Fatal error:  Uncaught Error: Call to undefined function undefined_fn\(\)|Fatal error: Uncaught Error: Call to undefined function undefined_fn\(\)/);
  const parse = await php(ctx, '<?php echo "unterminated;');
  assert.equal(parse.status, 255);
  assert.match(parse.stdout, /Parse error: syntax error/);
  const warn = await php(ctx, '<?php echo $undefined ?? "dflt", "\\n"; echo intdiv(7, 2), "\\n"; echo @file_get_contents("/nonexistent") === false ? "false\\n" : "?\\n";');
  assert.equal(warn.stdout, 'dflt\n3\nfalse\n');
  const exc = await php(ctx, '<?php try { throw new RuntimeException("boom", 3); } catch (RuntimeException $e) { echo get_class($e), " ", $e->getMessage(), " ", $e->getCode(), "\\n"; } finally { echo "finally\\n"; }');
  assert.equal(exc.stdout, 'RuntimeException boom 3\nfinally\n');

  // openssl_pkey_new() reads OpenSSL's config file, which slicc doesn't
  // have (/etc/ssl/openssl.cnf): without one it fails, as upstream does;
  // any file (even empty) through "config" or OPENSSL_CONF will do.
  await ctx.write('/tmp/php-cert/openssl.cnf', '# empty\n');
  const nocnf = await phpOk(ctx, '<?php var_dump(openssl_pkey_new(["private_key_type" => OPENSSL_KEYTYPE_EC, "curve_name" => "prime256v1"])); $e = []; while ($m = openssl_error_string()) $e[] = $m; echo implode("|", array_unique($e)), "\\n";');
  assert.match(nocnf, /^bool\(false\)\n.*configuration file routines::no such file/s, nocnf);
  const envcnf = await run(['php', '-r', 'var_dump(openssl_pkey_new(["private_key_type" => OPENSSL_KEYTYPE_EC, "curve_name" => "prime256v1"]) instanceof OpenSSLAsymmetricKey);'], { cwd: '/tmp', env: { OPENSSL_CONF: '/tmp/php-cert/openssl.cnf' } });
  assert.equal(envcnf.stdout, 'bool(true)\n', envcnf.stderr);

  // Core extensions at work.
  const out = await phpOk(ctx, `<?php
declare(strict_types=1);
echo json_encode(["a" => 1, "b" => [1.5, true, null], "u" => "é"], JSON_UNESCAPED_UNICODE), "\\n";
var_export(json_decode('{"x":{"y":[1,2,3]}}', true)); echo "\\n";
echo preg_replace_callback('/(\\d+)/', fn($m) => (string)($m[1] * 2), "a1 b22 c333"), "|", preg_match('/^\\p{Lu}\\p{Ll}+$/u', "Ünïcode"), "\\n";
echo mb_strtoupper("héllo wörld"), "|", mb_strlen("日本語"), "|", mb_substr("日本語テキスト", 2, 3), "|", mb_convert_encoding("é", "ISO-8859-1", "UTF-8") === "\\xe9" ? "mbconv" : "?", "\\n";
echo bin2hex(iconv("UTF-8", "ISO-8859-1", "é")), "|", iconv("ISO-8859-1", "UTF-8", "\\xfc"), "|", iconv_strlen("日本"), "\\n";
echo hash("sha256", "abc"), "|", hash("crc32b", "abc"), "|", md5("abc"), "|", hash_hmac("sha1", "data", "key"), "|", hash("xxh3", "abc"), "\\n";
echo openssl_digest("abc", "sha512"), "\\n";
$k = random_bytes(32); $iv = random_bytes(16);
$ct = openssl_encrypt("secret message", "aes-256-cbc", $k, 0, $iv);
echo openssl_decrypt($ct, "aes-256-cbc", $k, 0, $iv), "|", OPENSSL_VERSION_TEXT, "\\n";
$key = openssl_pkey_new(["private_key_type" => OPENSSL_KEYTYPE_EC, "curve_name" => "prime256v1", "config" => "/tmp/php-cert/openssl.cnf"]);
openssl_sign("payload", $sig, $key, OPENSSL_ALGO_SHA256);
echo openssl_verify("payload", $sig, openssl_pkey_get_details($key)["key"], OPENSSL_ALGO_SHA256), "\\n";
echo strlen(gzcompress(str_repeat("a", 10000))) < 100 ? "small" : "big", "|", gzuncompress(gzcompress("round")), "|", gzdecode(gzencode("trip")), "|", zlib_decode(zlib_encode("z", ZLIB_ENCODING_DEFLATE)), "\\n";
echo bcadd("123456789012345678901234567890", "987654321098765432109876543210"), "|", bcdiv("1", "3", 20), "|", bcpow("2", "100"), "\\n";
echo date("Y-m-d H:i:s T", 86400 * 365), "|", date_default_timezone_get(), "|", (new DateTimeImmutable("2024-02-28 23:00", new DateTimeZone("Europe/Berlin")))->modify("+1 day")->format(DATE_ATOM), "\\n";
echo (new DateTime("2026-03-29 01:30", new DateTimeZone("Europe/Berlin")))->modify("+1 hour")->format("H:i T"), "\\n";
mt_srand(42); echo mt_rand(1, 1000), "|", (new Random\\Randomizer(new Random\\Engine\\Mt19937(42)))->getInt(1, 1000), "|", strlen(bin2hex(random_bytes(8))), "\\n";
echo ctype_digit("123") ? "d" : "-", ctype_alpha("abc") ? "a" : "-", ctype_space(" \\t") ? "s" : "-", "|", filter_var("user@example.com", FILTER_VALIDATE_EMAIL), "|", var_export(filter_var("300", FILTER_VALIDATE_INT, ["options" => ["max_range" => 255]]), true), "\\n";
echo count(token_get_all('<?php echo 1 + 2;')), "|", token_name(T_ECHO), "\\n";
echo jdtogregorian(gregoriantojd(10, 22, 2026)), "|", cal_days_in_month(CAL_GREGORIAN, 2, 2024), "\\n";
echo posix_getpid() === getmypid() ? "pid" : "?", "|", posix_uname()["sysname"], "|", posix_getcwd(), "\\n";
echo session_status() === PHP_SESSION_NONE ? "session-none" : "?", "|", ini_get("session.save_handler"), "\\n";
echo serialize(["k" => new ArrayObject([1, 2])]) === serialize(unserialize(serialize(["k" => new ArrayObject([1, 2])]))) ? "serialize" : "?", "|", var_export(array_is_list([1, 2]), true), "|", str_contains("haystack", "st") ? "contains" : "?", "\\n";
enum Suit: string { case Hearts = "H"; case Spades = "S"; }
readonly class P { public function __construct(public int $x) {} }
echo Suit::from("S")->name, "|", (new P(3))->x, "|", match (true) { default => "match" }, "|", array_sum(array_map(fn(int $i): int => $i ** 2, range(1, 10))), "\\n";
$pipe = "  Hello " |> trim(...) |> strtoupper(...);
echo $pipe, "|", array_first([3, 2, 1]), "|", array_last([3, 2, 1]), "\\n";
`);
  const lines = out.split('\n');
  assert.equal(lines[0], '{"a":1,"b":[1.5,true,null],"u":"é"}');
  assert.match(out, /'y' => \n?\s*array \(\n\s*0 => 1,\n\s*1 => 2,\n\s*2 => 3,/);
  const rest = out.slice(out.indexOf("a2 b44"));
  const want = [
    'a2 b44 c666|1',
    'HÉLLO WÖRLD|3|語テキ|mbconv',
    'e9|ü|2',
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad|352441c2|900150983cd24fb0d6963f7d28e17f72|104152c5bfdca07bc633eebd46199f0255c9f49d|78af5f94892f3950',
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    /^secret message\|OpenSSL 3\.5\.9 /,
    '1',
    'small|round|trip|z',
    '1111111110111111111011111111100|0.33333333333333333333|1267650600228229401496703205376',
    '1971-01-01 00:00:00 UTC|UTC|2024-02-29T23:00:00+01:00',
    '03:30 CEST',
    /^\d+\|\d+\|16$/,
    'das|user@example.com|false',
    /^\d+\|T_ECHO$/,
    '10/22/2026|29',
    '/^pid\|wasi\|\/tmp$/',
    'session-none|files',
    'serialize|true|contains',
    'Spades|3|match|385',
    'HELLO|3|1',
  ];
  const got = rest.split('\n');
  want.forEach((w, i) => {
    if (w instanceof RegExp) assert.match(got[i], w, `line ${i}: ${got[i]}`);
    else if (w.startsWith('/^')) assert.match(got[i], new RegExp(w.slice(1, -1)), `line ${i}: ${got[i]}`);
    else assert.equal(got[i], w, `line ${i}`);
  });
  // mt_srand(42) gives MT19937's sequence for seed 42 (init_genrand), shifted right by one, on every platform.
  const mt = await phpOk(ctx, '<?php mt_srand(42); echo mt_rand(), " ", mt_rand(), "\\n";');
  assert.equal(mt, '804318771 1710563033\n');
}
