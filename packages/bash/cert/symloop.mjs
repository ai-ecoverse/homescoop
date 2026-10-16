/**
 * Symlink budget in bash's own path lookups (homescoop#611, #461): bash's
 * redirections go through its glue's FS.lookupPath, which until 5.3.0-18
 * ran 40 passes, the first following nothing, so `echo hi > <40-link chain>`
 * was "Symbolic link loop". 5.3.0-19 is built with
 * scripts/emsdk-patches/libfs-symloop.patch: 40 follows resolve, the 41st is
 * ELOOP, as on Linux.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

function tarball() {
  if (process.env.CERT_TARBALL) return process.env.CERT_TARBALL;
  const i = process.argv.indexOf('--tarball');
  return i >= 0 ? process.argv[i + 1] : '.homescoop-out/package.tgz';
}

function member(tgz, want) {
  const buf = gunzipSync(readFileSync(tgz));
  for (let at = 0; at + 512 <= buf.length; ) {
    const h = buf.subarray(at, at + 512);
    if (h.every((b) => b === 0)) break;
    const name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(h.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8);
    if (name === want) return buf.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${want} not in ${tgz}`);
}

export default async function (ctx) {
  const { run, assert } = ctx;
  const glue = member(tarball(), 'package/bin/bash').toString('utf8');
  assert.match(glue, /nlinks\s*<=\s*40/, "bin/bash's FS.lookupPath still stops at 40 passes (no libfs-symloop.patch)");
  // /tmp/s<n>/l0 → … → /tmp/s<n>/l<n-1> → /tmp/s<n>.f: n follows (links made with coreutils ln).
  const chain = (n) => `d=/tmp/s${n}; rm -rf $d && mkdir -p $d && printf E > $d.f && for i in $(seq 0 ${n - 2}); do ln -s $d/l$((i+1)) $d/l$i; done && ln -s $d.f $d/l${n - 1}`;
  for (const n of [39, 40]) {
    const r = await run(['bash', '-c', `${chain(n)} && echo hi > /tmp/s${n}/l0 && read -r x < /tmp/s${n}/l0 && echo "$x" && [ -e /tmp/s${n}/l0 ] && echo exists`], { cwd: '/tmp' });
    assert.equal(r.status, 0, `${n} follows: rc=${r.status} ${r.stdout}${r.stderr}`);
    assert.equal(r.stdout, 'hi\nexists\n', `${n} follows: bash writes, reads and tests through the chain: ${r.stdout}${r.stderr}`);
  }
  const over = await run(['bash', '-c', `${chain(41)} && { echo hi > /tmp/s41/l0; } 2>&1; echo "rc=$?"`], { cwd: '/tmp' });
  assert.match(over.stdout, /\/tmp\/s41\/l0: Symbolic link loop\nrc=1\n$/, `41 follows: ${over.stdout}${over.stderr}`);
  console.log('symloop: bash redirections and [ -e ] through 39 and 40 links work, the 41st is Symbolic link loop; the glue has nlinks <= 40');
}
