#!/usr/bin/env node
/**
 * host-node cert for wasix-openssh.
 *
 *   node packages/wasix-openssh/cert/run.mjs --tarball <package.tgz>
 *
 * Starts (on the HOST):
 *   1. ephemeral OpenSSH sshd (temp host/user keys, loopback)
 *   2. cert/none-auth-server.py (paramiko; accepts auth method none)
 *   3. a seeded bare git repo under the work dir (clone/push over sshd)
 * Then boots slicc-kernel's Node entry with an uplink that routes those
 * peers, installs the package tarball, and runs cert/*.mjs specs
 * (excluding this file).
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  chmodSync,
  existsSync,
  statSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { ptySession } from '../../../scripts/browser-cert/context.mjs';

/** Bridge a fakeUplink peer conn to a host TCP service (sshd / none-auth). */
function tcpProxy(host, port) {
  return (conn) => {
    const sock = net.connect({ host, port });
    const fail = (err) => {
      try {
        conn.end?.();
      } catch {
        /* ignore */
      }
      sock.destroy(err);
    };
    sock.on('error', fail);
    sock.on('connect', () => {
      void (async () => {
        try {
          for (;;) {
            const piece = await conn.read();
            if (!piece) break;
            if (!sock.write(Buffer.from(piece))) await new Promise((r) => sock.once('drain', r));
          }
        } catch (e) {
          fail(e);
        } finally {
          sock.end();
        }
      })();
      sock.on('data', (buf) => {
        try {
          conn.write(buf);
        } catch (e) {
          fail(e);
        }
      });
      sock.on('end', () => {
        try {
          conn.end?.();
        } catch {
          /* ignore */
        }
      });
    });
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const tarball = opt('--tarball');
if (!tarball) {
  console.error('usage: run.mjs --tarball <package.tgz>');
  process.exit(2);
}

const meta = JSON.parse(readFileSync(join(here, 'meta.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'wasix-openssh-cert-'));
const children = [];

function sh(cmd, argv, o = {}) {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', ...o });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${argv.join(' ')} failed: ${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

function cleanup() {
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  rmSync(work, { recursive: true, force: true });
}
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));

async function main() {
  console.log(`== wasix-openssh cert: ${resolve(tarball)}`);
  const extract = join(work, 'pkg');
  mkdirSync(extract, { recursive: true });
  sh('tar', ['xzf', resolve(tarball), '-C', extract]);
  const pkg = join(extract, 'package');
  if (!existsSync(join(pkg, 'bin/ssh.wasm'))) {
    throw new Error('package lacks bin/ssh.wasm — host-build must succeed first');
  }

  // --- host sshd (publickey) ---
  const sshdDir = join(work, 'sshd');
  mkdirSync(sshdDir, { recursive: true });
  const hostKey = join(sshdDir, 'host_ed25519');
  const userKey = join(sshdDir, 'id_ed25519');
  sh('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', hostKey, '-q']);
  sh('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', userKey, '-q']);
  const authKeys = join(sshdDir, 'authorized_keys');
  writeFileSync(authKeys, readFileSync(`${userKey}.pub`));
  chmodSync(authKeys, 0o600);
  const sshdConfig = join(sshdDir, 'sshd_config');
  // Port 0 is not always honoured by sshd; bind a free port ourselves.
  const probe = await import('node:net').then((m) => m.createServer());
  const sshdPort = await new Promise((res, rej) => {
    probe.listen(0, '127.0.0.1', () => {
      const p = probe.address().port;
      probe.close(() => res(p));
    });
    probe.on('error', rej);
  });
  const pidFile = join(sshdDir, 'sshd.pid');
  writeFileSync(
    sshdConfig,
    [
      `Port ${sshdPort}`,
      'ListenAddress 127.0.0.1',
      `HostKey ${hostKey}`,
      `PidFile ${pidFile}`,
      'UsePAM no',
      'PasswordAuthentication no',
      'KbdInteractiveAuthentication no',
      'PubkeyAuthentication yes',
      `AuthorizedKeysFile ${authKeys}`,
      'StrictModes no',
      'Subsystem sftp internal-sftp',
      '',
    ].join('\n'),
  );
  const sshdBin = sh('bash', ['-lc', 'command -v sshd || echo /usr/sbin/sshd']).trim();
  // High port + privsep off: unprivileged sshd on CI runners (no sudo).
  const sshd = spawn(sshdBin, ['-f', sshdConfig, '-D', '-e'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(sshd);
  sshd.stderr.on('data', (c) => process.stderr.write(c));
  await new Promise((r) => setTimeout(r, 400));
  if (sshd.exitCode !== null) {
    throw new Error(`sshd exited early with ${sshd.exitCode}`);
  }

  // --- none-auth server ---
  const noneKey = join(work, 'none_host_rsa');
  const none = spawn('python3', [join(here, 'none-auth-server.py'), '--host', '127.0.0.1', '--port', '0', '--host-key', noneKey], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(none);
  const nonePort = await new Promise((resolvePort, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('none-auth-server: no PORT=')), 10000);
    none.stdout.on('data', (c) => {
      buf += c;
      const m = buf.match(/PORT=(\d+)/);
      if (m) {
        clearTimeout(t);
        resolvePort(Number(m[1]));
      }
    });
    none.stderr.on('data', (c) => process.stderr.write(c));
    none.on('exit', (code) => {
      clearTimeout(t);
      reject(new Error(`none-auth-server exited ${code}`));
    });
  });

  // --- host bare git repo (clone/push over sshd) ---
  const xferDir = join(work, 'xfer');
  mkdirSync(xferDir, { recursive: true });
  const seedDir = join(work, 'seed');
  const bareDir = join(work, 'bare.git');
  mkdirSync(seedDir, { recursive: true });
  sh('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd: seedDir });
  writeFileSync(join(seedDir, 'README'), 'wasix-openssh cert seed\n');
  sh('git', ['-c', 'user.email=cert@example.com', '-c', 'user.name=cert', 'add', 'README'], {
    cwd: seedDir,
  });
  sh('git', ['-c', 'user.email=cert@example.com', '-c', 'user.name=cert', 'commit', '-m', 'seed'], {
    cwd: seedDir,
  });
  sh('git', ['clone', '--bare', seedDir, bareDir]);
  console.log(`== host sshd :${sshdPort}, none-auth :${nonePort}, bare ${bareDir}`);

  // --- kernel ---
  const nm = join(work, 'nm');
  mkdirSync(nm);
  sh('npm', [
    'install',
    '--prefix',
    nm,
    '--no-fund',
    '--no-audit',
    '--silent',
    meta.kernel,
    ...(meta.needsInstall || meta.needs || []),
  ]);
  const kernelRoot = join(nm, 'node_modules/@ai-ecoverse/slicc-kernel');
  const { createNodeKernel } = await import(pathToFileURL(join(kernelRoot, 'dist/node.js')).href);
  // Published package ships dist/ only; exports map "./testing" → dist/testing.js.
  const { fakeUplink } = await import(pathToFileURL(join(kernelRoot, 'dist/testing.js')).href);

  const uplink = fakeUplink({
    names: {
      'sshd.cert.internal': ['100.64.1.10'],
      'none.cert.internal': ['100.64.1.11'],
    },
    routes: { prefixes: ['100.64.0.0/10'] },
    peers: {
      '100.64.1.10:22': tcpProxy('127.0.0.1', sshdPort),
      '100.64.1.11:22': tcpProxy('127.0.0.1', nonePort),
    },
  });

  const kernel = await createNodeKernel({ network: { uplink } });
  const copyTree = async (src, dest) => {
    for (const e of readdirSync(src)) {
      const p = join(src, e);
      if (statSync(p).isDirectory()) await copyTree(p, `${dest}/${e}`);
      else await kernel.writeFile(`${dest}/${e}`, readFileSync(p));
    }
  };
  for (const need of meta.needs || []) {
    await copyTree(join(nm, 'node_modules', need), `/node_modules/${need}`);
  }
  await copyTree(pkg, '/node_modules/@ai-ecoverse/wasix-openssh');

  // Seed ~/.ssh with the user key for publickey tests.
  await kernel.writeFile('/root/.ssh/id_ed25519', readFileSync(userKey));
  await kernel.writeFile('/root/.ssh/id_ed25519.pub', readFileSync(`${userKey}.pub`));
  // writeFile defaults to 0644; OpenSSH rejects open private keys — chmod via coreutils.
  const chmod = await kernel.run(['chmod', '700', '/root/.ssh'], {
    cwd: '/root',
    env: {},
  });
  if (chmod.status !== 0) throw new Error(`chmod .ssh: ${chmod.stderr}`);
  const chmodKey = await kernel.run(['chmod', '600', '/root/.ssh/id_ed25519'], {
    cwd: '/root',
    env: {},
  });
  if (chmodKey.status !== 0) throw new Error(`chmod id_ed25519: ${chmodKey.stderr}`);

  // sshd authenticates a real host account; the guest must pass that name.
  const hostUser = sh('bash', ['-lc', 'id -un']).trim();

  // Guest ssh_config so scp/sftp/git share the same identity options.
  await kernel.writeFile(
    '/root/.ssh/config',
    [
      'Host sshd.cert.internal',
      `  User ${hostUser}`,
      '  IdentityFile /root/.ssh/id_ed25519',
      '  IdentitiesOnly yes',
      '  StrictHostKeyChecking accept-new',
      '  UserKnownHostsFile /root/.ssh/known_hosts',
      '',
      'Host none.cert.internal',
      '  User user',
      '  StrictHostKeyChecking no',
      '  UserKnownHostsFile /dev/null',
      '',
    ].join('\n'),
  );
  await kernel.run(['chmod', '600', '/root/.ssh/config'], {
    cwd: '/root',
    env: {},
  });

  // Root's home from the kernel's passwd (wasix-sysroot -20+: OpenSSH's ~ is
  // getpwuid()'s pw_dir, and HOME agrees); before -20 the cert faked /root.
  const guestEnv = {};
  const ctx = {
    assert,
    work,
    sshdPort,
    nonePort,
    hostUser,
    hostXfer: xferDir,
    hostBare: bareDir,
    // ssh://user@host/abs/path → absolute path on the sshd host.
    gitUrl: `ssh://${hostUser}@sshd.cert.internal${bareDir}`,
    hostKeyPub: readFileSync(`${hostKey}.pub`, 'utf8').trim(),
    run: (argv, o = {}) =>
      kernel.run(argv, {
        cwd: o.cwd || '/root',
        env: { ...guestEnv, ...(o.env || {}) },
        stdin: o.stdin,
      }),
    pty: (argv, o = {}) =>
      ptySession(kernel, argv, {
        ...o,
        cwd: o.cwd || '/root',
        env: { ...guestEnv, TERM: 'xterm-256color', ...(o.env || {}) },
      }),
    writeFile: (path, data) => kernel.writeFile(path, data),
    // wasix-openssh 10.6.0-6 (wasix-sysroot -22): users, host keys, the package.
    pkgDir: pkg,
    addUser: (o) => kernel.users.add(o),
    authorize: (pub) => appendFileSync(authKeys, `${pub.trim()}\n`),
    runAs: (user, argv, o = {}) =>
      kernel.run(argv, { cwd: o.cwd || '/', env: o.env || {}, stdin: o.stdin, ...(user !== 'root' && { user }) }),
  };

  let failed = 0;
  for (const spec of readdirSync(here)
    .filter((f) => f.endsWith('.mjs') && f !== 'run.mjs')
    .sort()) {
    try {
      await (await import(pathToFileURL(join(here, spec)).href)).default(ctx);
      console.log(`PASS cert/${spec}`);
    } catch (e) {
      failed = 1;
      console.log(`FAIL cert/${spec}\n${e.stack}`);
    }
  }
  try {
    await kernel.terminate();
  } catch {
    /* ignore */
  }
  process.exit(failed);
}

main().catch((e) => {
  console.error(e.stack || e);
  process.exit(1);
});
