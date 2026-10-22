/**
 * php -S, the built-in web server, on loopback: a router script, PHP pages
 * with $_GET/$_POST/$_SERVER and headers, static files with their MIME type,
 * 404s, a session cookie round trip, and several clients at once. The
 * clients are php (stream sockets and the http wrapper, direct: loopback is
 * in the kernel's no_proxy).
 */
import { phpOk } from './lib/php.mjs';

const ROUTER = `<?php
$u = parse_url($_SERVER["REQUEST_URI"], PHP_URL_PATH);
if ($u === "/static.txt" || $u === "/logo.svg") return false;
if ($u === "/json") { header("Content-Type: application/json"); header("X-Powered: wasix-php"); echo json_encode(["get" => $_GET, "post" => $_POST, "method" => $_SERVER["REQUEST_METHOD"], "sapi" => PHP_SAPI]); return true; }
if ($u === "/session") { session_start(); $_SESSION["n"] = ($_SESSION["n"] ?? 0) + 1; echo "visit ", $_SESSION["n"]; return true; }
if ($u === "/slow") { usleep(300000); echo "slow ", $_GET["i"]; return true; }
http_response_code(404); echo "no route ", $u;
`;

export default async function (ctx) {
  const { assert, run } = ctx;
  await run(['rm', '-rf', '/tmp/www'], { cwd: '/tmp' });
  await ctx.write('/tmp/www/router.php', ROUTER);
  await ctx.write('/tmp/www/static.txt', 'static file\n');
  await ctx.write('/tmp/www/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const server = run(['bash', '-c', 'php -S 127.0.0.1:18282 -t /tmp/www /tmp/www/router.php & echo $! > /tmp/www-pid; wait $!'], { cwd: '/tmp/www' });
  try {
    const out = await phpOk(ctx, `<?php
for ($i = 0; $i < 100 && !@fsockopen("127.0.0.1", 18282); $i++) usleep(100000);
$base = "http://127.0.0.1:18282";
function get($url, $ctx = null) { $b = file_get_contents($url, false, $ctx); return [$b, http_get_last_response_headers()]; }
[$b, $h] = get("$base/json?x=1&y[]=a&y[]=b"); echo $b, "|", $h[0], "|", implode(",", preg_grep("/^(Content-Type|X-Powered):/i", $h)), "\\n";
$c = stream_context_create(["http" => ["method" => "POST", "header" => "Content-Type: application/x-www-form-urlencoded", "content" => "k=v&n=2"]]);
[$b] = get("$base/json", $c); echo $b, "\\n";
[$b, $h] = get("$base/static.txt"); echo trim($b), "|", implode(",", preg_grep("/^Content-Type:/i", $h)), "\\n";
[$b, $h] = get("$base/logo.svg"); echo implode(",", preg_grep("/^Content-Type:/i", $h)), "\\n";
$ctx404 = stream_context_create(["http" => ["ignore_errors" => true]]);
[$b, $h] = get("$base/missing", $ctx404); echo $h[0], "|", $b, "\\n";
[$b, $h] = get("$base/session"); $cookie = explode(";", substr(array_values(preg_grep("/^Set-Cookie:/i", $h))[0], 12))[0];
$cc = stream_context_create(["http" => ["header" => "Cookie: $cookie"]]);
[$b2] = get("$base/session", $cc); [$b3] = get("$base/session", $cc); echo "$b|$b2|$b3|", str_starts_with($cookie, "PHPSESSID=") ? "PHPSESSID" : $cookie, "\\n";
`);
    const l = out.split('\n');
    assert.equal(l[0], '{"get":{"x":"1","y":["a","b"]},"post":[],"method":"GET","sapi":"cli-server"}|HTTP/1.1 200 OK|Content-Type: application/json,X-Powered: wasix-php', out);
    assert.equal(l[1], '{"get":[],"post":{"k":"v","n":"2"},"method":"POST","sapi":"cli-server"}');
    assert.equal(l[2], 'static file|Content-Type: text/plain; charset=UTF-8');
    assert.equal(l[3], 'Content-Type: image/svg+xml');
    assert.equal(l[4], 'HTTP/1.1 404 Not Found|no route /missing');
    assert.equal(l[5], 'visit 1|visit 2|visit 3|PHPSESSID');

    // Concurrent clients (php -S serves one request at a time; all finish).
    const many = await Promise.all([1, 2, 3, 4].map((i) => run(['php', '-r', `echo file_get_contents("http://127.0.0.1:18282/slow?i=${i}");`], { cwd: '/tmp' })));
    assert.deepEqual(many.map((r) => r.stdout), ['slow 1', 'slow 2', 'slow 3', 'slow 4']);

    // A raw HTTP/1.0 request over a stream socket.
    const raw = await phpOk(ctx, `<?php
$s = stream_socket_client("tcp://127.0.0.1:18282", $no, $str, 5);
fwrite($s, "GET /json?raw=1 HTTP/1.0\\r\\nHost: x\\r\\n\\r\\n");
$r = stream_get_contents($s); echo strtok($r, "\\r\\n"), "|", substr($r, strpos($r, "\\r\\n\\r\\n") + 4), "\\n";
`);
    assert.equal(raw, 'HTTP/1.0 200 OK|{"get":{"raw":"1"},"post":[],"method":"GET","sapi":"cli-server"}\n');
  } finally {
    await run(['bash', '-c', 'kill "$(cat /tmp/www-pid)"'], { cwd: '/tmp' });
  }
  const done = await Promise.race([server, new Promise((r) => setTimeout(() => r(null), 5000))]);
  assert.ok(done !== null, 'php -S exits when killed');
}
