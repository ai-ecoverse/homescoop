/**
 * wasix-perl Cwd (XS since 5.42.0-7: the DynaLoader marker lets Cwd.pm load
 * its XS getcwd; -6 ran the pure-Perl fallback). getcwd, cwd, abs_path and
 * File::Spec->rel2abs agree with the kernel in a plain directory, through a
 * symlinked directory, and inside a tmpfs mount (wasm-mount).
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const sh = async (script) => {
    const r = await run(['bash', '-c', script], { cwd: '/home' });
    assert.equal(r.status, 0, `${script}: rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    return r.stdout;
  };
  const probe = `perl -MCwd=getcwd,cwd,abs_path -MFile::Spec -e 'print join("|", getcwd(), cwd(), abs_path("."), File::Spec->rel2abs("x")), "\\n"'`;

  await sh('rm -rf /tmp/cw && mkdir -p /tmp/cw/a/b && ln -s /tmp/cw/a /tmp/cw/link');
  assert.equal(await sh(`cd /tmp/cw/a/b && ${probe}`), '/tmp/cw/a/b|/tmp/cw/a/b|/tmp/cw/a/b|/tmp/cw/a/b/x\n');
  // Through the symlink: the physical directory, like the kernel's pwd -P.
  const phys = (await sh('cd /tmp/cw/link/b && pwd -P')).trim();
  assert.equal(phys, '/tmp/cw/a/b');
  const viaLink = await sh(`cd /tmp/cw/link/b && ${probe}`);
  assert.match(viaLink, /^\/tmp\/cw\/a\/b\|\/tmp\/cw\/a\/b\|\/tmp\/cw\/a\/b\|\/tmp\/cw\/(a|link)\/b\/x\n$/, viaLink);
  assert.equal(await sh(`perl -MCwd=abs_path -e 'print abs_path("/tmp/cw/link/b"), "\\n"'`), '/tmp/cw/a/b\n');
  assert.equal(await sh(`cd / && perl -MCwd=abs_path -e 'print abs_path("tmp/cw/link/../a/b"), "\\n"'`), '/tmp/cw/a/b\n');

  // Inside a tmpfs mount.
  await sh('mkdir -p /mnt/t && mount -t tmpfs none /mnt/t && mkdir -p /mnt/t/x/y');
  try {
    assert.equal(await sh(`cd /mnt/t/x/y && ${probe}`), '/mnt/t/x/y|/mnt/t/x/y|/mnt/t/x/y|/mnt/t/x/y/x\n');
    assert.equal(await sh(`perl -MCwd=abs_path -e 'print abs_path("/mnt/t/x/../x/y"), "\\n"'`), '/mnt/t/x/y\n');
  } finally {
    await run(['bash', '-c', 'cd / && umount /mnt/t'], { cwd: '/home' });
  }
  // XS getcwd is live (not the pure-Perl fallback).
  // Cwd.pm aliases getcwd to _perl_getcwd when its XS did not load.
  assert.equal(await sh(`perl -MCwd -e 'print \\&Cwd::getcwd == \\&Cwd::_perl_getcwd ? "pp" : "xs", "\\n"'`), 'xs\n');
}
