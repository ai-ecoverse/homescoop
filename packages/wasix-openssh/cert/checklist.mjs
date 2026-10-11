/**
 * wasix-openssh host-node checklist.
 *
 * Expects cert/run.mjs context: run(), pty(), assert, hostUser, hostXfer,
 * hostBare, gitUrl, uplink peers sshd.cert.internal / none.cert.internal.
 */
export default async function checklist(ctx) {
  const { run, pty, assert, hostUser, hostXfer, gitUrl, writeFile } = ctx;
  const sshTarget = `${hostUser}@sshd.cert.internal`;
  const sshBatch = [
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'UserKnownHostsFile=/root/.ssh/known_hosts',
    '-o',
    'IdentitiesOnly=yes',
    '-i',
    '/root/.ssh/id_ed25519',
  ];

  // --- version / keygen ---
  {
    const v = await run(['ssh', '-V']);
    // OpenSSH prints version on stderr.
    const ver = `${v.stderr || ''}${v.stdout || ''}`;
    assert.match(ver, /OpenSSH_10\.6/, `ssh -V: ${ver}`);
  }

  {
    const r = await run(['ssh-keygen', '-t', 'ed25519', '-N', '', '-f', '/root/.ssh/cert_ed25519']);
    assert.equal(r.status, 0, `ssh-keygen: ${r.stderr}`);
    const st = await run(['stat', '-c', '%a', '/root/.ssh/cert_ed25519']);
    if (st.status === 0) {
      assert.equal(st.stdout.trim(), '600', 'private key mode 0600');
    }
  }

  // --- identity: root's home ---
  // OpenSSH 10.6 `ssh -G` omits userconfigfile; userknownhostsfile expands
  // ~ to root's home (/root from the kernel's passwd since wasix-sysroot -20).
  {
    const r = await run(['ssh', '-G', 'sshd.cert.internal'], {
      env: {},
    });
    assert.equal(r.status, 0, `ssh -G: ${r.stderr}`);
    assert.match(
      r.stdout,
      /userknownhostsfile \/root\/\.ssh\/known_hosts/i,
      `ssh -G HOME paths: ${r.stdout.slice(0, 400)}`,
    );
  }

  // --- exec + publickey via uplink ---
  {
    const r = await run(['ssh', ...sshBatch, sshTarget, 'echo', 'hi-exec']);
    assert.equal(r.status, 0, `ssh exec: ${r.stderr}`);
    assert.match(r.stdout, /hi-exec/);
  }

  // --- exit codes + stdin/stdout pipe + stderr separation ---
  // OpenSSH joins remote argv with spaces then hands the string to the login
  // shell — use `exit 3` as two words (not `bash -c 'exit 3'`, which word-splits).
  {
    const ex = await run(['ssh', ...sshBatch, sshTarget, 'exit', '3']);
    assert.equal(ex.status, 3, `ssh exit 3: status=${ex.status} stderr=${ex.stderr}`);
  }
  {
    const pipe = await run(['ssh', ...sshBatch, sshTarget, 'cat'], { stdin: 'pipe-x\n' });
    assert.equal(pipe.status, 0, `ssh cat pipe: ${pipe.stderr}`);
    assert.match(pipe.stdout, /pipe-x/);
  }
  {
    // stderr must be exactly the remote bytes — no IP_TOS setsockopt noise.
    const sep = await run(['ssh', ...sshBatch, sshTarget, 'echo x >&2']);
    assert.equal(sep.status, 0, `ssh stderr-only: ${sep.stderr}`);
    assert.equal(sep.stdout, '', `stdout should be empty: ${JSON.stringify(sep.stdout)}`);
    assert.equal(
      sep.stderr.replace(/\r/g, ''),
      'x\n',
      `stderr must be exactly "x\\n" (no IP_TOS spam): ${JSON.stringify(sep.stderr)}`,
    );
  }

  // --- known_hosts mismatch (isolated known_hosts file) ---
  {
    const kh = '/root/.ssh/known_hosts_mismatch';
    await run(['ssh', ...sshBatch, '-o', `UserKnownHostsFile=${kh}`, sshTarget, 'true']);
    const poison = await run([
      'bash',
      '-c',
      `echo "sshd.cert.internal ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" > ${kh}`,
    ]);
    assert.equal(poison.status, 0);
    const bad = await run([
      'ssh',
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      `UserKnownHostsFile=${kh}`,
      '-i',
      '/root/.ssh/id_ed25519',
      sshTarget,
      'true',
    ]);
    assert.notEqual(bad.status, 0, 'host key mismatch must fail');
  }

  // --- none auth (paramiko test server) ---
  {
    const r = await run([
      'ssh',
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'PreferredAuthentications=none',
      '-o',
      'PubkeyAuthentication=no',
      'user@none.cert.internal',
      'true',
    ]);
    assert.equal(r.status, 0, `none auth: ${r.stderr}`);
    assert.match(r.stdout, /none-ok/);
  }

  // --- PTY via openTerminal: size, type, exit; record local ^C (#247) ---
  {
    const cols = 100;
    const rows = 30;
    const size = await pty(['ssh', '-t', ...sshBatch, sshTarget, 'stty', 'size'], {
      cols,
      rows,
      timeoutMs: 30000,
    });
    assert.equal(size.status, 0, `ssh -t stty size: status=${size.status} out=${JSON.stringify(size.out)}`);
    // stty size prints "rows cols"
    assert.match(
      size.out.replace(/\r/g, ''),
      new RegExp(`${rows}\\s+${cols}`),
      `remote stty size should match local pty ${rows}x${cols}: ${JSON.stringify(size.out)}`,
    );
  }
  {
    // Interactive: one remote-shell string (avoids ssh argv join / word-split).
    // Print READY, read a line from the PTY, eval it, then exit.
    const sess = await pty(
      [
        'ssh',
        '-tt',
        ...sshBatch,
        sshTarget,
        'sh -c \'echo READY; read cmd; eval "$cmd"; echo DONE\'',
      ],
      {
        cols: 80,
        rows: 24,
        steps: [
          { expect: 'READY', write: 'echo typed-ok\n' },
          { expect: 'typed-ok' },
          { expect: 'DONE' },
        ],
        timeoutMs: 30000,
      },
    );
    assert.equal(
      sess.status,
      0,
      `interactive ssh -t: status=${sess.status} failed=${JSON.stringify(sess.failedStep)} out=${JSON.stringify(sess.out).slice(0, 500)}`,
    );
    assert.match(sess.out.replace(/\r/g, ''), /typed-ok/);
  }
  {
    // 10.6.0-6 (wasix-sysroot -21 per-fd termios, slicc-kernel >= 1.48):
    // enter_raw_mode really clears ISIG, so ^C goes to the remote as a byte.
    // The remote traps INT and exits 7; ssh reports the remote's status.
    // (Before -21, slicc-kernel#247: ^C interrupted the local ssh.)
    const ctrlc = await pty(
      ['ssh', '-t', ...sshBatch, sshTarget, 'trap "echo remote-int; exit 7" INT; echo armed; sleep 120 & wait'],
      {
        cols: 80,
        rows: 24,
        steps: [{ expect: 'armed' }, { sleepMs: 300, write: '\x03' }, { expect: 'remote-int', timeoutMs: 10000 }],
        timeoutMs: 15000,
      },
    );
    assert.ok(!ctrlc.failedStep, `^C did not reach the remote: ${JSON.stringify(ctrlc.out).slice(0, 400)}`);
    assert.equal(ctrlc.status, 7, `ssh should report the remote's exit 7 after ^C; status=${ctrlc.status}`);
    console.log('note: ^C reached the remote (trap → exit 7), ssh exit 7');
  }

  // --- scp / sftp 256 KiB round-trips with checksums ---
  {
    const mk = await run([
      'bash',
      '-c',
      'head -c 262144 /dev/urandom > /root/blob.bin && wc -c /root/blob.bin',
    ]);
    assert.equal(mk.status, 0, `make blob: ${mk.stderr}`);
    assert.match(mk.stdout, /262144/);
    const sumUp = await run(['sha256sum', '/root/blob.bin']);
    assert.equal(sumUp.status, 0, `sha256sum blob: ${sumUp.stderr}`);
    const hash = sumUp.stdout.trim().split(/\s+/)[0];
    assert.match(hash, /^[0-9a-f]{64}$/);

    const remoteScp = `${hostXfer}/scp-up.bin`;
    const scpUp = await run([
      'scp',
      ...sshBatch,
      '/root/blob.bin',
      `${sshTarget}:${remoteScp}`,
    ]);
    assert.equal(scpUp.status, 0, `scp up: ${scpUp.stderr}`);
    const scpDown = await run([
      'scp',
      ...sshBatch,
      `${sshTarget}:${remoteScp}`,
      '/root/blob-scp.bin',
    ]);
    assert.equal(scpDown.status, 0, `scp down: ${scpDown.stderr}`);
    const sumScp = await run(['sha256sum', '/root/blob-scp.bin']);
    assert.equal(sumScp.status, 0);
    assert.equal(sumScp.stdout.trim().split(/\s+/)[0], hash, 'scp round-trip checksum');
  }
  // Multi-source + -3: regression for do_cmd() argv pollution on global `args`.
  {
    const seed = await run([
      'ssh',
      ...sshBatch,
      sshTarget,
      `sh -c 'printf one > ${hostXfer}/m1; printf two > ${hostXfer}/m2'`,
    ]);
    assert.equal(seed.status, 0, `seed remote m1/m2: ${seed.stderr}`);
    const mkd = await run(['mkdir', '-p', '/root/scpmulti', '/root/scpmulti-O']);
    assert.equal(mkd.status, 0);

    const multi = await run([
      'scp',
      ...sshBatch,
      `${sshTarget}:${hostXfer}/m1`,
      `${sshTarget}:${hostXfer}/m2`,
      '/root/scpmulti/',
    ]);
    assert.equal(multi.status, 0, `scp two remotes (sftp): ${multi.stderr}\n${multi.stdout}`);
    const c1 = await run(['cat', '/root/scpmulti/m1']);
    const c2 = await run(['cat', '/root/scpmulti/m2']);
    assert.equal(c1.stdout, 'one', `m1: ${JSON.stringify(c1)}`);
    assert.equal(c2.stdout, 'two', `m2: ${JSON.stringify(c2)}`);

    const multiO = await run([
      'scp',
      '-O',
      ...sshBatch,
      `${sshTarget}:${hostXfer}/m1`,
      `${sshTarget}:${hostXfer}/m2`,
      '/root/scpmulti-O/',
    ]);
    assert.equal(multiO.status, 0, `scp -O two remotes: ${multiO.stderr}\n${multiO.stdout}`);
    const o1 = await run(['cat', '/root/scpmulti-O/m1']);
    const o2 = await run(['cat', '/root/scpmulti-O/m2']);
    assert.equal(o1.stdout, 'one');
    assert.equal(o2.stdout, 'two');

    const three = await run([
      'scp',
      '-3',
      ...sshBatch,
      `${sshTarget}:${hostXfer}/m1`,
      `${sshTarget}:${hostXfer}/m1.copy`,
    ]);
    assert.equal(three.status, 0, `scp -3: ${three.stderr}\n${three.stdout}`);
    const copy = await run(['ssh', ...sshBatch, sshTarget, 'cat', `${hostXfer}/m1.copy`]);
    assert.equal(copy.status, 0, `read m1.copy: ${copy.stderr}`);
    assert.equal(copy.stdout, 'one', `m1.copy: ${JSON.stringify(copy.stdout)}`);
  }
  {
    const remoteSftp = `${hostXfer}/sftp-up.bin`;
    await writeFile(
      '/root/sftp.batch',
      [`put /root/blob.bin ${remoteSftp}`, `get ${remoteSftp} /root/blob-sftp.bin`, 'bye', ''].join(
        '\n',
      ),
    );
    const batch = await run(['sftp', ...sshBatch, '-b', '/root/sftp.batch', sshTarget]);
    assert.equal(batch.status, 0, `sftp -b: ${batch.stderr}\n${batch.stdout}`);
    const sumSftp = await run(['sha256sum', '/root/blob-sftp.bin']);
    assert.equal(sumSftp.status, 0, `sha256sum sftp: ${sumSftp.stderr}`);
    const sumBlob = await run(['sha256sum', '/root/blob.bin']);
    assert.equal(
      sumSftp.stdout.trim().split(/\s+/)[0],
      sumBlob.stdout.trim().split(/\s+/)[0],
      'sftp -b round-trip checksum',
    );
  }

  // --- git over ssh (wasm-git + GIT_SSH_COMMAND) ---
  {
    const sshCmd =
      'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/root/.ssh/known_hosts -o IdentitiesOnly=yes -i /root/.ssh/id_ed25519';
    const clone = await run(['git', 'clone', gitUrl, '/root/cloned'], {
      env: { GIT_SSH_COMMAND: sshCmd },
    });
    assert.equal(clone.status, 0, `git clone: ${clone.stderr}\n${clone.stdout}`);
    const log = await run(['git', '-C', '/root/cloned', 'log', '-1', '--format=%s']);
    assert.equal(log.status, 0);
    assert.match(log.stdout, /seed/);
    const prep = await run([
      'bash',
      '-c',
      [
        'git -C /root/cloned config user.email cert@example.com',
        'git -C /root/cloned config user.name cert',
        'echo push-ok >> /root/cloned/README',
        'git -C /root/cloned add README',
        'git -C /root/cloned commit -m push-ok',
      ].join(' && '),
    ]);
    assert.equal(prep.status, 0, `git prep: ${prep.stderr}`);
    const push = await run(['git', '-C', '/root/cloned', 'push', 'origin', 'HEAD'], {
      env: { GIT_SSH_COMMAND: sshCmd },
    });
    assert.equal(push.status, 0, `git push: ${push.stderr}\n${push.stdout}`);
    // Prove the bare repo on the host received the commit (via another clone).
    const clone2 = await run(['git', 'clone', gitUrl, '/root/cloned2'], {
      env: { GIT_SSH_COMMAND: sshCmd },
    });
    assert.equal(clone2.status, 0, `git clone2: ${clone2.stderr}`);
    const log2 = await run(['git', '-C', '/root/cloned2', 'log', '-1', '--format=%s']);
    assert.match(log2.stdout, /push-ok/);
  }

  // --- ssh-keygen -R (known_hosts backup without hard links) ---
  {
    await run(['ssh', ...sshBatch, sshTarget, 'true']);
    const rm = await run([
      'ssh-keygen',
      '-R',
      'sshd.cert.internal',
      '-f',
      '/root/.ssh/known_hosts',
    ]);
    assert.equal(rm.status, 0, `ssh-keygen -R: ${rm.stderr}\n${rm.stdout}`);
    const old = await run(['test', '-f', '/root/.ssh/known_hosts.old']);
    assert.equal(old.status, 0, 'known_hosts.old retained after -R');
  }

  // --- ssh-add without agent (ssh-agent is not shipped) ---
  {
    // No SSH_AUTH_SOCK in the guest env → ssh-add cannot talk to an agent.
    const list = await run(['ssh-add', '-l'], { env: { SSH_AUTH_SOCK: '' } });
    assert.equal(list.status, 2, `ssh-add -l without agent: status=${list.status} out=${list.stdout}${list.stderr}`);
    assert.match(
      `${list.stdout}${list.stderr}`,
      /Could not open a connection to your authentication agent/i,
    );
  }
}
