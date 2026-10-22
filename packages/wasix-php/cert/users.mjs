/**
 * Users and file modes (cert/meta.json users: enforce). Root is uid 0 with
 * home /root; a kernel.users.add user gets its own ids, posix_getpwuid()
 * entry and HOME, can't write into /root, and owns what it creates. umask,
 * chmod, mkdir modes and fileperms() agree with coreutils' stat.
 */
import { php, phpOk } from './lib/php.mjs';

export default async function (ctx) {
  const { assert, run } = ctx;
  await ctx.addUser({ name: 'cone' });
  const ids = 'echo posix_getuid(), "|", posix_getgid(), "|", posix_getpwuid(posix_geteuid())["name"], "|", posix_getpwuid(posix_geteuid())["dir"], "|", getenv("HOME"), "\\n";';
  assert.equal(await phpOk(ctx, `<?php ${ids}`), '0|0|root|/root|/root\n');
  assert.equal(await phpOk(ctx, `<?php ${ids}`, { user: 'cone', cwd: '/home/cone', dir: '/tmp/php-cert-cone' }), '1000|1000|cone|/home/cone|/home/cone\n');

  const denied = await php(ctx, `<?php
var_dump(is_writable("/root"), @file_put_contents("/root/cone-was-here", "x")); echo error_get_last()["message"] ?? "", "\\n";
file_put_contents("/home/cone/mine.txt", "mine"); echo fileowner("/home/cone/mine.txt"), ":", filegroup("/home/cone/mine.txt"), "\\n";
`, { user: 'cone', cwd: '/home/cone', dir: '/tmp/php-cert-cone' });
  assert.equal(denied.status, 0, denied.stderr);
  assert.equal(denied.stdout, 'bool(false)\nbool(false)\nfile_put_contents(/root/cone-was-here): Failed to open stream: Permission denied\n1000:1000\n');

  await run(['rm', '-rf', '/tmp/php-modes'], { cwd: '/tmp' });
  const modes = await phpOk(ctx, `<?php
mkdir("/tmp/php-modes"); chdir("/tmp/php-modes");
$old = umask(027); touch("grp"); umask($old);
mkdir("priv", 0700); touch("exe"); chmod("exe", 0755);
$t = tempnam("/tmp/php-modes", "tmp"); rename($t, "/tmp/php-modes/tmpf");
printf("%03o\\n", $old);
foreach (["grp", "priv", "exe", "tmpf"] as $f) { clearstatcache(); printf("%s %o\\n", $f, fileperms($f) & 0777); }
echo is_executable("exe") ? "exe is executable" : "exe is not executable", "\\n";
`);
  assert.equal(modes, '022\ngrp 640\npriv 700\nexe 755\ntmpf 600\nexe is executable\n');
  const st = await run(['stat', '-c', '%a %n', 'grp', 'priv', 'exe', 'tmpf'], { cwd: '/tmp/php-modes' });
  assert.equal(st.stdout, '640 grp\n700 priv\n755 exe\n600 tmpf\n', st.stderr);
}
