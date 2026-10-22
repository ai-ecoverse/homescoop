/**
 * patches/0005: sys_get_temp_dir() is /tmp without TMPDIR, so tempnam(),
 * tmpfile(), php://temp past its memory limit and Phar's temporary files
 * work. A phar is built (with a gzip-compressed entry and a stub), run as a
 * script, read through phar:// and extracted. TMPDIR and sys_temp_dir still
 * win.
 */
import { phpOk } from './lib/php.mjs';

export default async function (ctx) {
  const { assert, run } = ctx;
  assert.equal(await phpOk(ctx, `<?php
echo var_export(getenv("TMPDIR"), true), "|", sys_get_temp_dir(), "\\n";
$t = tempnam("", "php"); echo dirname($t), "|", file_exists($t) ? "exists" : "missing", "\\n"; unlink($t);
$f = tmpfile(); fwrite($f, "tmpfile data"); rewind($f); echo fread($f, 100), "|", dirname(stream_get_meta_data($f)["uri"]), "\\n";
$m = fopen("php://temp/maxmemory:1024", "w+"); fwrite($m, str_repeat("x", 100000)); rewind($m); echo strlen(stream_get_contents($m)), "\\n";
`), "false|/tmp\n/tmp|exists\ntmpfile data|/tmp\n100000\n");
  const env = await run(['php', '-r', 'echo sys_get_temp_dir(), "|", dirname(tempnam("", "x")), "\\n";'], { cwd: '/tmp', env: { TMPDIR: '/home/' } });
  assert.equal(env.stdout, '/home|/home\n', env.stderr);
  const ini = await run(['php', '-d', 'sys_temp_dir=/root', '-r', 'echo sys_get_temp_dir(), "\\n";'], { cwd: '/tmp' });
  assert.equal(ini.stdout, '/root\n', ini.stderr);

  await run(['rm', '-rf', '/tmp/phar-cert'], { cwd: '/tmp' });
  assert.equal(await phpOk(ctx, `<?php
@mkdir("/tmp/phar-cert");
$p = new Phar("/tmp/phar-cert/app.phar");
$p->startBuffering();
$p["index.php"] = '<?php require __DIR__ . "/lib/greet.php"; echo greet($argv[1] ?? "phar"), "\\n";';
$p["lib/greet.php"] = '<?php function greet($w) { return "hello " . $w . " from " . basename(Phar::running(false)); }';
$p["data.txt"] = str_repeat("compressible ", 1000);
$p["data.txt"]->compress(Phar::GZ);
$p->setStub("#!/usr/bin/env php\\n" . $p->createDefaultStub("index.php"));
$p->setSignatureAlgorithm(Phar::SHA256);
$p->stopBuffering();
echo count($p), "|", $p["data.txt"]->isCompressed(Phar::GZ) ? "gz" : "plain", "|", $p->getSignature()["hash_type"], "\\n";
`, { flags: ['-d', 'phar.readonly=0'] }), '3|gz|SHA-256\n');
  const ran = await run(['php', '/tmp/phar-cert/app.phar', 'world'], { cwd: '/tmp' });
  assert.equal(ran.stdout, 'hello world from app.phar\n', ran.stderr);
  assert.equal(await phpOk(ctx, `<?php
echo strlen(file_get_contents("phar:///tmp/phar-cert/app.phar/data.txt")), "|";
$p = new Phar("/tmp/phar-cert/app.phar"); $p->extractTo("/tmp/phar-cert/out", null, true);
echo implode(",", array_map(fn($f) => substr($f, strlen("/tmp/phar-cert/out/")), glob("/tmp/phar-cert/out/{*,*/*}", GLOB_BRACE))), "\\n";
`), '13000|data.txt,index.php,lib,lib/greet.php\n');
  // A tar-based archive (PharData) and its gzip conversion, through temp files.
  assert.equal(await phpOk(ctx, `<?php
$t = new PharData("/tmp/phar-cert/a.tar"); $t["x/y.txt"] = "in tar"; $gz = $t->compress(Phar::GZ);
echo basename($gz->getPath()), "|", file_get_contents("phar:///tmp/phar-cert/a.tar.gz/x/y.txt"), "\\n";
`), 'a.tar.gz|in tar\n');
}
