/**
 * timeout finds its command through PATH (slicc-kernel#1165): coreutils'
 * timeout-slicc.patch spawns with posix_spawnp, and the Emscripten shim's
 * posix_spawnp (shims/slicc/slicc_spawn.c) now searches PATH as musl's execvp
 * does, then hands a bare name to the kernel's catalog.
 *
 * On 9.12.0-10 (the negative, NEGATIVE.md) posix_spawnp was posix_spawn: the
 * bare name reached the kernel, which only knows its catalog, so a script on
 * PATH was 'No such file or directory' (127).
 *
 * A directory named like the command earlier on PATH passes access(X_OK) but
 * can't be spawned; posix_spawnp skips it, as execvp does, and runs the script
 * later on PATH. A name that only a directory matches is EACCES (126).
 */
export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  await addUser({ name: 'cone' });
  const setup = [
    'mkdir -p /tmp/hs1165/pbin /tmp/hs1165/rel /tmp/hs1165/dbin/hs1165script /tmp/hs1165/dbin/hs1165dironly',
    "printf '#!/bin/sh\\necho path-ran\\n' > /tmp/hs1165/pbin/hs1165script",
    'chmod 755 /tmp/hs1165/pbin/hs1165script',
    "printf '#!/bin/sh\\necho rel-ran\\n' > /tmp/hs1165/rel/script",
    'chmod 755 /tmp/hs1165/rel/script',
    "printf '#!/bin/sh\\necho never\\n' > /tmp/hs1165/pbin/hs1165noexec",
    'chmod 644 /tmp/hs1165/pbin/hs1165noexec',
  ].join('; ');
  const ready = await run(['bash', '-c', setup], { cwd: '/tmp', user: 'cone' });
  assert.equal(ready.status, 0, `setup stderr=${ready.stderr}`);
  const timed = (cmd) =>
    run(['bash', '-c', `export PATH="/tmp/hs1165/dbin:/tmp/hs1165/pbin:$PATH"; cd /tmp/hs1165; timeout 5 ${cmd}`], {
      cwd: '/tmp',
      user: 'cone',
    });

  // dbin/hs1165script is a directory ahead of the script on PATH: skipped.
  const byName = await timed('hs1165script');
  assert.equal(byName.status, 0, `timeout 5 hs1165script rc=${byName.status} stderr=${byName.stderr}`);
  assert.equal(byName.stdout, 'path-ran\n');

  const rel = await timed('./rel/script');
  assert.equal(rel.status, 0, `timeout 5 ./rel/script rc=${rel.status} stderr=${rel.stderr}`);
  assert.equal(rel.stdout, 'rel-ran\n');

  const catalog = await timed('seq 2');
  assert.equal(catalog.status, 0, `timeout 5 seq 2 rc=${catalog.status} stderr=${catalog.stderr}`);
  assert.equal(catalog.stdout, '1\n2\n');

  const noexec = await timed('hs1165noexec');
  assert.equal(noexec.status, 126, `non-executable rc=${noexec.status} stderr=${noexec.stderr}`);
  assert.match(noexec.stderr, /Permission denied/);

  // dbin/hs1165dironly is a directory and nothing else on PATH is named so.
  const dirOnly = await timed('hs1165dironly');
  assert.equal(dirOnly.status, 126, `directory-only rc=${dirOnly.status} stderr=${dirOnly.stderr}`);
  assert.match(dirOnly.stderr, /Permission denied/);

  const missing = await timed('hs1165-no-such-command');
  assert.equal(missing.status, 127, `missing rc=${missing.status} stderr=${missing.stderr}`);
  assert.match(missing.stderr, /No such file or directory/);
}
