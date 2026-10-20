export default async function crypto(ctx) {
  const { run, assert, hostUser, authorize } = ctx;
  const T = `${hostUser}@sshd.cert.internal`;
  const B = ['-o', 'BatchMode=yes'];
  const log = (...a) => console.log('crypto:', ...a);
  const ok = (r, what) => assert.equal(r.status, 0, `${what}: status ${r.status} ${r.stderr}`);

  for (const [t, extra] of [['rsa', ['-b', '3072']], ['ecdsa', ['-b', '384']], ['ed25519', []]]) {
    const f = `/root/.ssh/x_${t}`;
    ok(await run(['ssh-keygen', '-q', '-t', t, ...extra, '-N', 'pass phrase', '-f', f]), `keygen ${t}`);
    const y = await run(['ssh-keygen', '-y', '-P', 'pass phrase', '-f', f]);
    ok(y, `keygen -y ${t}`);
    const wrong = await run(['ssh-keygen', '-y', '-P', 'nope', '-f', f]);
    assert.notEqual(wrong.status, 0, `wrong passphrase accepted for ${t}`);
    ok(await run(['ssh-keygen', '-p', '-P', 'pass phrase', '-N', '', '-f', f]), `keygen -p ${t}`);
    const l = await run(['ssh-keygen', '-l', '-f', `${f}.pub`]);
    ok(l, `keygen -l ${t}`);
    authorize(y.stdout);
    const r = await run(['ssh', ...B, '-F', '/dev/null', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'UserKnownHostsFile=/root/.ssh/known_hosts', '-o', 'IdentitiesOnly=yes', '-i', f, T, 'echo', `key-${t}`]);
    ok(r, `login ${t}`);
    assert.equal(r.stdout, `key-${t}\n`);
    log(t, l.stdout.trim());
  }

  {
    await ctx.writeFile('/root/msg.txt', 'hello signed world\n');
    ok(await run(['ssh-keygen', '-Y', 'sign', '-f', '/root/.ssh/x_ed25519', '-n', 'file', '/root/msg.txt']), 'Y sign');
    const pub = (await run(['cat', '/root/.ssh/x_ed25519.pub'])).stdout.trim();
    await ctx.writeFile('/root/allowed', `me@x ${pub}\n`);
    ok(await run(['ssh-keygen', '-Y', 'verify', '-f', '/root/allowed', '-I', 'me@x', '-n', 'file', '-s', '/root/msg.txt.sig'], { stdin: 'hello signed world\n' }), 'Y verify');
    const bad = await run(['ssh-keygen', '-Y', 'verify', '-f', '/root/allowed', '-I', 'me@x', '-n', 'file', '-s', '/root/msg.txt.sig'], { stdin: 'tampered\n' });
    assert.notEqual(bad.status, 0, 'tampered message verified');
  }

  const combos = [
    ['Ciphers', 'chacha20-poly1305@openssh.com'], ['Ciphers', 'aes256-gcm@openssh.com'],
    ['Ciphers', 'aes128-ctr'], ['Ciphers', 'aes256-ctr'],
    ['MACs', 'hmac-sha2-512-etm@openssh.com'], ['MACs', 'hmac-sha2-256'], ['MACs', 'umac-128-etm@openssh.com'],
    ['KexAlgorithms', 'mlkem768x25519-sha256'], ['KexAlgorithms', 'sntrup761x25519-sha512'],
    ['KexAlgorithms', 'curve25519-sha256'], ['KexAlgorithms', 'ecdh-sha2-nistp256'],
  ];
  for (const [k, v] of combos) {
    const extra = k === 'MACs' ? ['-o', 'Ciphers=aes128-ctr'] : [];
    const r = await run(['ssh', ...B, '-o', `${k}=${v}`, ...extra, T, 'echo', 'ok']);
    ok(r, `${k}=${v}`);
    assert.equal(r.stdout, 'ok\n', `${k}=${v} stdout`);
  }
  log('ciphers/kex/macs ok:', combos.length);

  {
    ok(await run(['bash', '-c', 'yes compressible-line | head -c 2097152 > /root/c.bin; head -c 1048576 /dev/urandom > /root/r.bin; cat c.bin r.bin > /root/cr.bin']), 'gen');
    const local = (await run(['sha256sum', '/root/cr.bin'])).stdout.split(' ')[0];
    const up = await run(['bash', '-c', `ssh -C -o BatchMode=yes ${T} sha256sum < /root/cr.bin`]);
    ok(up, 'ssh -C upload');
    assert.equal(up.stdout.split(' ')[0], local, 'ssh -C upload checksum');
    const down = await run(['bash', '-c', `ssh -C -o BatchMode=yes ${T} 'yes zz | head -c 3000000' | sha256sum`]);
    ok(down, 'ssh -C download');
    const want = (await run(['bash', '-c', 'yes zz | head -c 3000000 | sha256sum'])).stdout;
    assert.equal(down.stdout, want, 'ssh -C download checksum');
    const v = await run(['ssh', '-C', '-v', ...B, T, 'true']);
    assert.match(v.stderr, /compression: zlib|Enabling compression/i, `compression not negotiated: ${v.stderr.slice(-800)}`);
    log('ssh -C up/down 3 MiB ok');
  }

  {
    const t0 = Date.now();
    const r = await run(['bash', '-c', `ssh -o BatchMode=yes ${T} 'yes' | head -c 5; echo; echo rc=\${PIPESTATUS[0]}`]);
    log('remote yes | head:', JSON.stringify(r.stdout), `${Date.now() - t0} ms`, r.stderr.slice(0, 200));
    assert.match(r.stdout, /^yy?\n?y?/);
    assert.ok(Date.now() - t0 < 20000, 'ssh | head did not terminate promptly');
    const t1 = Date.now();
    const r2 = await run(['bash', '-c', `yes | head -c 1000000 | ssh -o BatchMode=yes ${T} 'head -c 10 >/dev/null; echo done'`]);
    ok(r2, 'remote closes stdin early');
    assert.match(r2.stdout, /done/);
    log('remote early stdin close ok', `${Date.now() - t1} ms`);
  }

  {
    const F = await run(['ssh-keygen', '-F', 'sshd.cert.internal', '-f', '/root/.ssh/known_hosts']);
    ok(F, 'keygen -F');
  }
}
