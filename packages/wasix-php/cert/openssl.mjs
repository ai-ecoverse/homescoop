import { php, phpOk } from './lib/php.mjs';

const KEYS = `<?php
$rsa = openssl_pkey_new();
$ec = openssl_pkey_new(["private_key_type" => OPENSSL_KEYTYPE_EC, "curve_name" => "prime256v1"]);
if (!$rsa || !$ec) { $e = []; while ($m = openssl_error_string()) $e[] = $m; echo "nokey|", implode("|", array_unique($e)), "\\n"; exit(1); }
$r = openssl_pkey_get_details($rsa); $c = openssl_pkey_get_details($ec);
echo $r["type"] === OPENSSL_KEYTYPE_RSA ? "rsa" : "?", " ", $r["bits"], "|", $c["type"] === OPENSSL_KEYTYPE_EC ? "ec" : "?", " ", $c["ec"]["curve_name"], " ", $c["bits"], "\\n";
foreach (["rsa" => $rsa, "ec" => $ec] as $name => $key) {
  $dn = ["countryName" => "DE", "organizationName" => "homescoop", "commonName" => "$name.example.test"];
  $csr = openssl_csr_new($dn, $key);
  if (!$csr) { $e = []; while ($m = openssl_error_string()) $e[] = $m; echo "nocsr|", implode("|", array_unique($e)), "\\n"; exit(1); }
  $subject = openssl_csr_get_subject($csr);
  $x509 = openssl_csr_sign($csr, null, $key, 30, [], 7);
  openssl_x509_export($x509, $pem);
  $info = openssl_x509_parse($pem);
  $pub = openssl_pkey_get_details(openssl_csr_get_public_key($csr))["key"];
  openssl_pkey_export($key, $priv);
  echo $name, " csr ", $subject["CN"], " ", $subject["O"], "|cert ", $info["subject"]["CN"], " issuer ", $info["issuer"]["CN"], " serial ", $info["serialNumber"], " ", $info["signatureTypeSN"], "|verify ", openssl_x509_verify($pem, $pub), "|check ", var_export(openssl_x509_check_private_key($pem, $key), true), "|", str_starts_with($priv, "-----BEGIN PRIVATE KEY-----") ? "pem" : "?", "\\n";
}
`;

const BITS = `<?php
$k = openssl_pkey_new(...(isset($argv[1]) ? [["config" => $argv[1]]] : []));
if (!$k) { $e = []; while ($m = openssl_error_string()) $e[] = $m; echo "false|", implode("|", array_unique($e)), "\\n"; exit; }
echo openssl_pkey_get_details($k)["bits"], "\\n";
`;

export default async function (ctx) {
  const { run, assert } = ctx;

  const out = await phpOk(ctx, KEYS);
  const lines = out.split('\n');
  assert.equal(lines[0], 'rsa 2048|ec prime256v1 256', out);
  assert.match(lines[1], /^rsa csr rsa\.example\.test homescoop\|cert rsa\.example\.test issuer rsa\.example\.test serial 7 RSA-SHA256\|verify 1\|check true\|pem$/, out);
  assert.match(lines[2], /^ec csr ec\.example\.test homescoop\|cert ec\.example\.test issuer ec\.example\.test serial 7 ecdsa-with-SHA256\|verify 1\|check true\|pem$/, out);

  const where = await phpOk(ctx, '<?php $f = getenv("OPENSSL_CONF"); echo $f, "|", is_readable($f) ? "readable" : "missing", "|", openssl_get_cert_locations()["default_cert_file"], "\\n";');
  assert.match(where, /^\/\S*\/etc\/openssl\.cnf\|readable\|/, where);
  const cnf = where.split('|')[0];
  assert.equal(await ctx.read(cnf), '[ req ]\ndefault_bits = 2048\ndefault_md = sha256\ndistinguished_name = req_distinguished_name\n\n[ req_distinguished_name ]\n');

  await ctx.write('/tmp/php-cert/bits1024.cnf', '[ req ]\ndefault_bits = 1024\ndistinguished_name = dn\n[ dn ]\n');
  await ctx.write('/tmp/php-cert/bits1536.cnf', '[ req ]\ndefault_bits = 1536\ndistinguished_name = dn\n[ dn ]\n');
  await ctx.write('/tmp/php-cert/bits.php', BITS);
  const viaRun = await run(['php', '/tmp/php-cert/bits.php'], { cwd: '/tmp', env: { OPENSSL_CONF: '/tmp/php-cert/bits1024.cnf' } });
  assert.equal(viaRun.stdout, '1024\n', viaRun.stderr);
  const viaShell = await run(['bash', '-c', 'OPENSSL_CONF=/tmp/php-cert/bits1536.cnf php /tmp/php-cert/bits.php; export OPENSSL_CONF=/tmp/php-cert/bits1024.cnf; php /tmp/php-cert/bits.php; php -r \'echo getenv("OPENSSL_CONF"), "\\n";\''], { cwd: '/tmp' });
  assert.equal(viaShell.stdout, '1536\n1024\n/tmp/php-cert/bits1024.cnf\n', viaShell.stderr);
  const missing = await run(['php', '/tmp/php-cert/bits.php'], { cwd: '/tmp', env: { OPENSSL_CONF: '/tmp/php-cert/none.cnf' } });
  assert.match(missing.stdout, /^false\|.*(no such file|No such file or directory)/, missing.stdout + missing.stderr);

  assert.equal(await phpOk(ctx, BITS, { args: ['/tmp/php-cert/bits1536.cnf'] }), '1536\n');
  assert.equal(await phpOk(ctx, BITS, { args: ['/tmp/php-cert/bits1024.cnf'], env: { OPENSSL_CONF: '/tmp/php-cert/bits1536.cnf' } }), '1024\n');
  const badConfig = await php(ctx, BITS, { args: ['/tmp/php-cert/none.cnf'] });
  assert.match(badConfig.stdout, /^false\|/, badConfig.stdout + badConfig.stderr);

  const child = await phpOk(ctx, '<?php echo shell_exec("php -r \'echo getenv(\\"OPENSSL_CONF\\");\'"), "|", var_export(openssl_pkey_new(["private_key_type" => OPENSSL_KEYTYPE_EC, "curve_name" => "prime256v1"]) instanceof OpenSSLAsymmetricKey, true), "\\n";');
  assert.equal(child, `${cnf}|true\n`);
}
