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
    'UserKnownHostsFile=/home/user/.ssh/known_hosts',
    '-o',
    'IdentitiesOnly=yes',
    '-i',
    '/home/user/.ssh/id_ed25519',
  ];

  // --- version / keygen ---
  {
    const v = await run(['ssh', '-V']);
    // OpenSSH prints version on stderr.
    const ver = `${v.stderr || ''}${v.stdout || ''}`;
    assert.match(ver, /OpenSSH_10\.6/, `ssh -V: ${ver}`);
  }

  {
    const r = await run(['ssh-keygen', '-t', 'ed25519', '-N', '', '-f', '/home/user/.ssh/cert_ed25519']);
    assert.equal(r.status, 0, `ssh-keygen: ${r.stderr}`);
    const st = await run(['stat', '-c', '%a', '/home/user/.ssh/cert_ed25519']);
    if (st.status === 0) {
      assert.equal(st.stdout.trim(), '600', 'private key mode 0600');
    }
  }

  // --- identity: $HOME ---
  // OpenSSH 10.6 `ssh -G` omits userconfigfile; userknownhostsfile still
  // expands under $HOME (same path policy as ~/.ssh/config).
  {
    const r = await run(['ssh', '-G', 'sshd.cert.internal'], {
      env: { HOME: '/home/user', USER: 'user' },
    });
    assert.equal(r.status, 0, `ssh -G: ${r.stderr}`);
    assert.match(
      r.stdout,
      /userknownhostsfile \/home\/user\/\.ssh\/known_hosts/i,
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
    // One remote-shell string so `;` and redirects survive.
    const sep = await run(['ssh', ...sshBatch, sshTarget, 'echo out-msg; echo err-msg >&2']);
    assert.equal(sep.status, 0, `ssh stdio split: ${sep.stderr}`);
    assert.match(sep.stdout, /out-msg/);
    assert.doesNotMatch(sep.stdout, /err-msg/);
    assert.match(sep.stderr, /err-msg/);
  }

  // --- known_hosts mismatch (isolated known_hosts file) ---
  {
    const kh = '/home/user/.ssh/known_hosts_mismatch';
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
      '/home/user/.ssh/id_ed25519',
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
    // Current behaviour under slicc-kernel#247: tty_set cannot clear ISIG, so a
    // local ^C (0x03) interrupts the local ssh rather than reaching the remote.
    // Assert that: we do not patch OpenSSH around this; escape ~. is the out.
    const ctrlc = await pty(['ssh', '-t', ...sshBatch, sshTarget, 'sleep', '120'], {
      cols: 80,
      rows: 24,
      steps: [
        // Wait until the session is up (sshd accepts / sleep running), then ^C.
        { sleepMs: 800, write: '\x03' },
      ],
      timeoutMs: 15000,
    });
    // SIGINT → 128+2 = 130 is the usual shell report; kernel may surface 130 or
    // another non-zero. null means the harness hung up after timeout (also fail).
    assert.notEqual(
      ctrlc.status,
      0,
      `local ^C should interrupt local ssh (#247); status=${ctrlc.status} out=${JSON.stringify(ctrlc.out).slice(0, 300)}`,
    );
    assert.ok(
      ctrlc.status === 130 || ctrlc.status === 255 || (ctrlc.status !== null && ctrlc.status !== 0),
      `local ^C current behaviour (#247): local ssh exited status=${ctrlc.status} (expect SIGINT-ish, not a clean remote exit)`,
    );
    console.log(
      `note: local ^C → ssh status=${ctrlc.status} (slicc-kernel#247: ISIG not cleared; ~. to disconnect)`,
    );
  }

  // --- scp / sftp 256 KiB round-trips with checksums ---
  {
    const mk = await run([
      'bash',
      '-c',
      'head -c 262144 /dev/urandom > /home/user/blob.bin && wc -c /home/user/blob.bin',
    ]);
    assert.equal(mk.status, 0, `make blob: ${mk.stderr}`);
    assert.match(mk.stdout, /262144/);
    const sumUp = await run(['sha256sum', '/home/user/blob.bin']);
    assert.equal(sumUp.status, 0, `sha256sum blob: ${sumUp.stderr}`);
    const hash = sumUp.stdout.trim().split(/\s+/)[0];
    assert.match(hash, /^[0-9a-f]{64}$/);

    const remoteScp = `${hostXfer}/scp-up.bin`;
    const scpUp = await run([
      'scp',
      ...sshBatch,
      '/home/user/blob.bin',
      `${sshTarget}:${remoteScp}`,
    ]);
    assert.equal(scpUp.status, 0, `scp up: ${scpUp.stderr}`);
    const scpDown = await run([
      'scp',
      ...sshBatch,
      `${sshTarget}:${remoteScp}`,
      '/home/user/blob-scp.bin',
    ]);
    assert.equal(scpDown.status, 0, `scp down: ${scpDown.stderr}`);
    const sumScp = await run(['sha256sum', '/home/user/blob-scp.bin']);
    assert.equal(sumScp.status, 0);
    assert.equal(sumScp.stdout.trim().split(/\s+/)[0], hash, 'scp round-trip checksum');
  }
  {
    const remoteSftp = `${hostXfer}/sftp-up.bin`;
    await writeFile(
      '/home/user/sftp.batch',
      [`put /home/user/blob.bin ${remoteSftp}`, `get ${remoteSftp} /home/user/blob-sftp.bin`, 'bye', ''].join(
        '\n',
      ),
    );
    const batch = await run(['sftp', ...sshBatch, '-b', '/home/user/sftp.batch', sshTarget]);
    assert.equal(batch.status, 0, `sftp -b: ${batch.stderr}\n${batch.stdout}`);
    const sumSftp = await run(['sha256sum', '/home/user/blob-sftp.bin']);
    assert.equal(sumSftp.status, 0, `sha256sum sftp: ${sumSftp.stderr}`);
    const sumBlob = await run(['sha256sum', '/home/user/blob.bin']);
    assert.equal(
      sumSftp.stdout.trim().split(/\s+/)[0],
      sumBlob.stdout.trim().split(/\s+/)[0],
      'sftp -b round-trip checksum',
    );
  }

  // --- git over ssh (wasm-git + GIT_SSH_COMMAND) ---
  {
    const sshCmd =
      'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/home/user/.ssh/known_hosts -o IdentitiesOnly=yes -i /home/user/.ssh/id_ed25519';
    const clone = await run(['git', 'clone', gitUrl, '/home/user/cloned'], {
      env: { GIT_SSH_COMMAND: sshCmd },
    });
    assert.equal(clone.status, 0, `git clone: ${clone.stderr}\n${clone.stdout}`);
    const log = await run(['git', '-C', '/home/user/cloned', 'log', '-1', '--format=%s']);
    assert.equal(log.status, 0);
    assert.match(log.stdout, /seed/);
    const prep = await run([
      'bash',
      '-c',
      [
        'git -C /home/user/cloned config user.email cert@example.com',
        'git -C /home/user/cloned config user.name cert',
        'echo push-ok >> /home/user/cloned/README',
        'git -C /home/user/cloned add README',
        'git -C /home/user/cloned commit -m push-ok',
      ].join(' && '),
    ]);
    assert.equal(prep.status, 0, `git prep: ${prep.stderr}`);
    const push = await run(['git', '-C', '/home/user/cloned', 'push', 'origin', 'HEAD'], {
      env: { GIT_SSH_COMMAND: sshCmd },
    });
    assert.equal(push.status, 0, `git push: ${push.stderr}\n${push.stdout}`);
    // Prove the bare repo on the host received the commit (via another clone).
    const clone2 = await run(['git', 'clone', gitUrl, '/home/user/cloned2'], {
      env: { GIT_SSH_COMMAND: sshCmd },
    });
    assert.equal(clone2.status, 0, `git clone2: ${clone2.stderr}`);
    const log2 = await run(['git', '-C', '/home/user/cloned2', 'log', '-1', '--format=%s']);
    assert.match(log2.stdout, /push-ok/);
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
