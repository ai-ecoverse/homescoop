/**
 * patches/0007: http:// and https:// streams take the kernel's proxy from
 * http_proxy/https_proxy when the context sets none. ctx.serve() is the far
 * end, behind slicc-kernel's realm proxy; https is CONNECT plus TLS against
 * the kernel CA (wasm-tls-engine), verified by OpenSSL through
 * SSL_CERT_FILE. GET, POST with a context, headers, redirects, error
 * statuses, gzip; then the environment rules: no_proxy (a name, a .suffix,
 * *, an IPv4 CIDR) goes direct, a context proxy wins, and a dead proxy in
 * http_proxy is what PHP connects to.
 */
import { php, phpOk } from './lib/php.mjs';

// A self-signed CA that signed nothing (packages/curl/cert/checklist.mjs's decoy).
const DECOY_CA = `-----BEGIN CERTIFICATE-----
MIIBejCCASCgAwIBAgIUVTMLtKUXhLNhIhmQiIQ8WMhSLNwwCgYIKoZIzj0EAwIw
IjEgMB4GA1UEAwwXaG9tZXNjb29wIGNlcnQgZGVjb3kgQ0EwIBcNMjYxMDA5MTcw
OTM3WhgPMjEyNjA5MTUxNzA5MzdaMCIxIDAeBgNVBAMMF2hvbWVzY29vcCBjZXJ0
IGRlY295IENBMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE/TMSJELEOITBRPuB
cmBf4meqXUgzoCELxJOs3hlV1QJHijgmPmrut4eak18G7RdYdY4mFKLGkjVVUrjy
R5LWaqMyMDAwHQYDVR0OBBYEFP0MmyVlQ8xDflSyX1HrBR56yoZCMA8GA1UdEwEB
/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIhAPgov50uSXyN4V+xve6j+J4Vj0Jm
2kTV6HVbVm4c1XnCAiA7+Rd3tWEZR14eORFRylER2Q7RXS2nywUx+ePgmISgrg==
-----END CERTIFICATE-----
`;

// Runs in the page: self-contained.
async function responder(req) {
  const u = new URL(req.url);
  const hdr = (n) => (req.headers.find(([k]) => k.toLowerCase() === n) || [])[1] || '';
  const p = u.pathname;
  if (p === '/hello') return { headers: [['content-type', 'text/plain'], ['x-cert', 'php']], body: `hello ${u.protocol} ${req.method}\n` };
  if (p === '/echo') {
    const body = JSON.stringify({ method: req.method, ct: hdr('content-type'), xh: hdr('x-homescoop'), ua: hdr('user-agent'), body: new TextDecoder().decode(req.body), query: u.search });
    return { headers: [['content-type', 'application/json']], body };
  }
  if (p.startsWith('/redirect/')) {
    const n = Number(p.split('/')[2]);
    return { status: 302, statusText: 'Found', headers: [['location', n > 0 ? `/redirect/${n - 1}` : '/hello']], body: '' };
  }
  if (p.startsWith('/status/')) {
    const c = Number(p.split('/')[2]);
    return { status: c, statusText: 'Cert', headers: [['content-type', 'text/plain']], body: `status ${c}\n` };
  }
  if (p === '/blob') {
    const b = new Uint8Array(300000);
    for (let i = 0; i < b.length; i++) b[i] = (i * 7 + (i >> 9)) & 255;
    return { headers: [['content-type', 'application/octet-stream']], body: b };
  }
  return { status: 404, statusText: 'Not Found', headers: [], body: 'not found\n' };
}

export default async function (ctx) {
  const { assert, run } = ctx;
  await ctx.serve(responder);

  assert.equal(await phpOk(ctx, `<?php
echo var_export(getenv("http_proxy"), true), "|", var_export(getenv("https_proxy"), true), "\\n";
foreach (["http", "https"] as $s) {
  echo file_get_contents("$s://example.test/hello");
  echo http_get_last_response_headers()[0], "|", implode(",", preg_grep("/^x-cert:/i", http_get_last_response_headers())), "\\n";
}
`), "'http://127.0.0.1:3128'|'http://127.0.0.1:3128'\nhello http: GET\nHTTP/1.1 200 OK|x-cert: php\nhello https: GET\nHTTP/1.1 200 OK|x-cert: php\n");

  const post = JSON.parse(await phpOk(ctx, `<?php
$c = stream_context_create(["http" => ["method" => "POST", "header" => "Content-Type: application/x-www-form-urlencoded\\r\\nX-Homescoop: cert", "content" => http_build_query(["a" => 1, "b" => "two words"])]]);
echo file_get_contents("https://example.test/echo?q=1", false, $c);
`));
  assert.deepEqual(post, { method: 'POST', ct: 'application/x-www-form-urlencoded', xh: 'cert', ua: '', body: 'a=1&b=two+words', query: '?q=1' });

  assert.equal(await phpOk(ctx, `<?php
echo file_get_contents("http://example.test/redirect/3");
$c = stream_context_create(["http" => ["max_redirects" => 1]]);
var_dump(@file_get_contents("http://example.test/redirect/3", false, $c)); echo error_get_last()["message"], "\\n";
var_dump(@file_get_contents("https://example.test/status/404")); echo http_get_last_response_headers()[0], "\\n";
$c = stream_context_create(["http" => ["ignore_errors" => true]]);
echo file_get_contents("https://example.test/status/500", false, $c), http_get_last_response_headers()[0], "\\n";
$b = file_get_contents("https://example.test/blob"); echo strlen($b), "|", ord($b[299999]), "\\n";
$f = fopen("http://example.test/hello", "r"); echo stream_get_meta_data($f)["wrapper_type"], "|", fgets($f); fclose($f);
`), "hello http: GET\nbool(false)\nfile_get_contents(http://example.test/redirect/3): Failed to open stream: Redirection limit reached, aborting\nbool(false)\nHTTP/1.1 404 Cert\nstatus 500\nHTTP/1.1 500 Cert\n300000|" + (((299999 * 7) + (299999 >> 9)) & 255) + "\nhttp|hello http: GET\n");

  // TLS verification is OpenSSL's, against the kernel CA from SSL_CERT_FILE.
  await ctx.write('/tmp/decoy-ca.pem', DECOY_CA);
  assert.equal(await phpOk(ctx, `<?php
echo getenv("SSL_CERT_FILE"), "|", openssl_get_cert_locations()["default_cert_file_env"], "\\n";
$bad = stream_context_create(["ssl" => ["cafile" => "/tmp/decoy-ca.pem"]]);
$errs = []; set_error_handler(function ($no, $str) use (&$errs) { $errs[] = $str; return true; });
var_dump(file_get_contents("https://example.test/hello", false, $bad)); restore_error_handler();
echo preg_match("/certificate verify failed/", implode(" ", $errs)) ? "verify failed" : implode(" ", $errs), "\\n";
$off = stream_context_create(["ssl" => ["cafile" => "/tmp/decoy-ca.pem", "verify_peer" => false, "verify_peer_name" => false]]);
echo file_get_contents("https://example.test/hello", false, $off);
`), '/etc/ssl/certs/slicc-kernel-ca.pem|SSL_CERT_FILE\nbool(false)\nverify failed\nhello https: GET\n');

  // The environment rules (the patch). no_proxy names, suffixes and *: a
  // direct connection to example.test has no route (getaddrinfo fails).
  const direct = 'var_dump(@file_get_contents("http://example.test/hello")); echo error_get_last()["message"] ?? "", "\\n";';
  for (const np of ['example.test', '.test', 'other.invalid, EXAMPLE.test', '*']) {
    const r = await php(ctx, `<?php ${direct}`, { env: { no_proxy: np, NO_PROXY: np } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^bool\(false\)\n.*getaddrinfo for example\.test failed/s, `no_proxy=${np}: ${r.stdout}`);
  }
  for (const np of ['test.example', 'xample.test', '127.0.0.0/8']) {
    const r = await php(ctx, `<?php echo file_get_contents("http://example.test/hello");`, { env: { no_proxy: np, NO_PROXY: np } });
    assert.equal(r.stdout, 'hello http: GET\n', `no_proxy=${np} still proxies example.test: ${r.stdout}${r.stderr}`);
  }
  // A dead proxy in the environment is the one PHP dials; HTTPS_PROXY (upper
  // case) counts for https, HTTP_PROXY (httpoxy) doesn't for http.
  const dead = await php(ctx, `<?php var_dump(@file_get_contents("http://example.test/hello")); echo error_get_last()["message"], "\\n";`, { env: { http_proxy: 'http://127.0.0.1:9' } });
  assert.match(dead.stdout, /^bool\(false\)\n.*Failed to open stream: Connection refused/s, dead.stdout);
  const upper = await php(ctx, `<?php var_dump(@file_get_contents("https://example.test/hello")); echo error_get_last()["message"], "\\n";`, { env: { https_proxy: '', HTTPS_PROXY: '127.0.0.1:9' } });
  assert.match(upper.stdout, /Connection refused/, upper.stdout);
  const httpoxy = await php(ctx, `<?php ${direct}`, { env: { http_proxy: '', HTTP_PROXY: 'http://127.0.0.1:3128' } });
  assert.match(httpoxy.stdout, /getaddrinfo for example\.test failed/, `HTTP_PROXY alone is ignored: ${httpoxy.stdout}`);
  const all = await php(ctx, `<?php echo file_get_contents("http://example.test/hello");`, { env: { http_proxy: '', all_proxy: 'http://127.0.0.1:3128' } });
  assert.equal(all.stdout, 'hello http: GET\n', `all_proxy: ${all.stdout}${all.stderr}`);
  // A context proxy wins over the environment (upstream behaviour).
  const ctxp = await php(ctx, `<?php
$c = stream_context_create(["http" => ["proxy" => "tcp://127.0.0.1:3128", "request_fulluri" => true]]);
echo file_get_contents("http://example.test/hello", false, $c);`, { env: { http_proxy: 'http://127.0.0.1:9' } });
  assert.equal(ctxp.stdout, 'hello http: GET\n', ctxp.stdout + ctxp.stderr);
  // An unsupported proxy scheme is ignored, so the request goes direct.
  const socks = await php(ctx, `<?php ${direct}`, { env: { http_proxy: 'socks5://127.0.0.1:1080' } });
  assert.match(socks.stdout, /getaddrinfo for example\.test failed/, socks.stdout);

  // Loopback goes direct (the kernel's no_proxy has 127.0.0.0/8): php -S answers.
  const srv = await run(['bash', '-c', `mkdir -p /tmp/http-cert && echo '<?php echo "direct ", $_SERVER["REQUEST_URI"], "\\n";' > /tmp/http-cert/index.php
php -S 127.0.0.1:18181 -t /tmp/http-cert >/tmp/http-cert/log 2>&1 & s=$!
for i in $(seq 1 50); do php -r 'exit(@fsockopen("127.0.0.1", 18181) ? 0 : 1);' && break; sleep 0.2; done
php -r 'echo file_get_contents("http://127.0.0.1:18181/x?y=1");' ; kill $s; wait $s 2>/dev/null; true`], { cwd: '/tmp' });
  assert.equal(srv.stdout, 'direct /x?y=1\n', srv.stderr);
}
