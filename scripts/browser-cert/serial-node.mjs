import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ptySession } from './context.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function fakeSerial({ loop = true } = {}) {
  const calls = [];
  const ports = [];
  const hook = {
    open(request) {
      calls.push({ op: 'open', path: request.path, flags: request.flags, uid: request.stamp?.uid });
      let controller;
      const port = {
        written: [],
        push: (text) => controller.enqueue(encoder.encode(text)),
        text: () => decoder.decode(new Uint8Array(port.written)),
      };
      const readable = new ReadableStream(
        {
          start: (c) => {
            controller = c;
          },
        },
        { highWaterMark: 0 },
      );
      const writable = new WritableStream({
        write(chunk) {
          port.written.push(...chunk);
          if (loop) controller.enqueue(chunk.slice());
        },
      });
      ports.push(port);
      return {
        readable,
        writable,
        control(op, args) {
          calls.push(args === undefined ? { op } : { op, args });
          if (op === 'signals') return { clearToSend: true, dataCarrierDetect: true, dataSetReady: true, ringIndicator: false };
          return undefined;
        },
      };
    },
  };
  const ops = (op) => calls.filter((c) => c.op === op);
  return { hook, calls, ports, ops };
}

export function parseArgs(argv) {
  const at = (n) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return { tarball: at('--tarball'), kernel: at('--kernel'), only: at('--only')?.split(',') };
}

export async function serialHarness({ root, tarball, needsInstall = [], kernelSpec }) {
  const work = mkdtempSync(join(tmpdir(), 'serial-node-'));
  const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString();
  const pkg = join(work, 'pkg');
  mkdirSync(pkg);
  sh('tar', ['xzf', resolve(tarball), '-C', pkg]);
  const manifest = JSON.parse(readFileSync(join(pkg, 'package/package.json'), 'utf8'));
  const devKernel = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies['@ai-ecoverse/slicc-kernel'];
  const spec = kernelSpec ?? process.env.HOMESCOOP_CERT_KERNEL ?? `@ai-ecoverse/slicc-kernel@${devKernel}`;
  const nm = join(work, 'nm');
  mkdirSync(nm);
  const localKernel = existsSync(join(spec, 'dist/node.js'));
  const installs = localKernel ? needsInstall : [spec, ...needsInstall];
  if (installs.length) sh('npm', ['install', '--prefix', nm, '--no-fund', '--no-audit', '--silent', ...installs]);
  const kroot = localKernel ? resolve(spec) : join(nm, 'node_modules/@ai-ecoverse/slicc-kernel');
  const kver = JSON.parse(readFileSync(join(kroot, 'package.json'), 'utf8')).version;
  const { createNodeKernel } = await import(pathToFileURL(join(kroot, 'dist/node.js')).href);
  const trees = [
    [join(pkg, 'package'), `/node_modules/${manifest.name}`],
    ...needsInstall.map((need) => {
      const name = need.replace(/(.)@[^@]*$/, '$1');
      return [join(nm, 'node_modules', name), `/node_modules/${name}`];
    }),
  ];
  const boot = async ({ loop = true } = {}) => {
    const devices = fakeSerial({ loop });
    const kernel = await createNodeKernel({ users: 'enforce', devices: devices.hook, approve: () => 'deny' });
    const copy = async (src, dest) => {
      for (const e of readdirSync(src)) {
        const p = join(src, e);
        if (statSync(p).isDirectory()) await copy(p, `${dest}/${e}`);
        else await kernel.writeFile(`${dest}/${e}`, readFileSync(p));
      }
    };
    for (const [src, dest] of trees) await copy(src, dest);
    await kernel.groups.add('dialout', { gid: 20 });
    await kernel.users.add({ name: 'cone', groups: ['dialout'] });
    const node = await kernel.devices.add({
      path: 'ttyUSB0',
      owner: 0,
      group: 'dialout',
      mode: 0o640,
      links: ['usb-0403_6001-if00'],
    });
    return {
      kernel,
      devices,
      node,
      run: (argv, o = {}) => kernel.run(argv, { cwd: o.cwd ?? '/root', ...o }),
      pty: (argv, o = {}) => ptySession(kernel, argv, { cwd: '/root', ...o }),
      until: async (what, check, ms = 20000) => {
        const end = Date.now() + ms;
        while (!check()) {
          if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
          await new Promise((r) => setTimeout(r, 20));
        }
      },
    };
  };
  return {
    kver,
    manifest,
    boot,
    cleanup: () => rmSync(work, { recursive: true, force: true }),
  };
}

export async function runCases(harness, cases, { only, label }) {
  const passed = [];
  for (const [name, fn] of Object.entries(cases)) {
    if (only && !only.includes(name)) continue;
    const env = await harness.boot(fn.boot);
    try {
      await fn(env);
      passed.push(name);
      console.log(`${label}: ${name} ok`);
    } catch (err) {
      err.message = `${label} ${name} (slicc-kernel ${harness.kver}): ${err.message}`;
      throw err;
    } finally {
      env.kernel.terminate();
    }
  }
  return passed;
}
