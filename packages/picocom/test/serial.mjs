import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, runCases, serialHarness } from '../../../scripts/browser-cert/serial-node.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = parseArgs(process.argv.slice(2));
assert.ok(args.tarball, 'usage: serial.mjs --tarball <package.tgz> [--kernel <spec>] [--only a,b]');
const meta = JSON.parse(readFileSync(join(here, '../cert/meta.json'), 'utf8'));

const CA = '\x01';
const show = (r) => `rc=${r.status}${r.failedStep ? ` stuck at ${JSON.stringify(r.failedStep)}` : ''}\n--- out\n${JSON.stringify(r.out ?? r.stdout).slice(-1500)}${r.stderr ? `\n--- stderr\n${JSON.stringify(r.stderr)}` : ''}`;
const bauds = (devices) => devices.ops('configure').map((c) => c.args.baudRate);

const cases = {
  async 'sudo picocom -b 115200 echoes through the loopback and C-a C-x exits'({ pty, devices }) {
    const r = await pty(['sudo', 'picocom', '-b', '115200', '/dev/ttyUSB0'], {
      steps: [
        { expect: 'Terminal ready' },
        { write: 'hello-loop\r' },
        { expect: 'hello-loop' },
        { write: `${CA}\x18` },
        { expect: 'Thanks for using picocom' },
      ],
    });
    assert.equal(r.status, 0, show(r));
    assert.match(r.out, /baudrate is\s*: 115200/, show(r));
    assert.equal(devices.ports.length, 1);
    assert.equal(devices.ports[0].text(), 'hello-loop\r', 'the escape keys never reach the port');
    const opens = devices.ops('open');
    assert.equal(opens.length, 1);
    assert.equal(opens[0].flags, 2, 'O_RDWR');
    assert.equal(opens[0].uid, 0, 'sudo opens it as root');
    assert.deepEqual(devices.ops('configure')[0].args, { baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' });
    assert.equal(bauds(devices).filter((b) => b === 115200).length, 1, `one configure at 115200: ${JSON.stringify(bauds(devices))}`);
    assert.deepEqual(bauds(devices), [115200, 9600], 'C-a C-x resets the port to the speed it had');
    assert.equal(devices.ops('close').length, 1);
  },

  async 'negative: a port that does not echo shows nothing typed'({ pty, devices }) {
    const r = await pty(['sudo', 'picocom', '-b', '115200', '/dev/ttyUSB0'], {
      steps: [{ expect: 'Terminal ready' }, { write: 'hello-loop\r', sleepMs: 0 }, { sleepMs: 1500, write: `${CA}\x18` }, { expect: 'Thanks for using picocom' }],
    });
    assert.equal(r.status, 0, show(r));
    assert.equal(devices.ports[0].text(), 'hello-loop\r');
    assert.doesNotMatch(r.out, /hello-loop/, 'picocom has no local echo: the first case sees the bytes only because the hook loops them back');
  },

  async 'C-a C-q quits without resetting the port'({ pty, devices }) {
    const r = await pty(['sudo', 'picocom', '-b', '115200', '/dev/ttyUSB0'], {
      steps: [{ expect: 'Terminal ready' }, { write: `${CA}\x11` }, { expect: 'Skipping tty reset' }, { expect: 'Thanks for using picocom' }],
    });
    assert.equal(r.status, 0, show(r));
    assert.deepEqual(bauds(devices), [115200], 'no reset, so only the one configure');
    assert.equal(devices.ops('close').length, 1);
  },

  async 'C-a C-t lowers DTR through TIOCMBIC and C-a C-v reads the lines'({ pty, devices }) {
    const r = await pty(['sudo', 'picocom', '-b', '115200', '/dev/ttyUSB0'], {
      steps: [
        { expect: 'Terminal ready' },
        { write: `${CA}\x14` },
        { expect: 'DTR: down' },
        { write: `${CA}\x16` },
        { expect: 'DTR: down' },
        { write: `${CA}\x18` },
        { expect: 'Thanks for using picocom' },
      ],
    });
    assert.equal(r.status, 0, show(r));
    assert.match(r.out, /\*\*\* DTR: down/, show(r));
    assert.match(r.out, /DSR: up/, 'TIOCMGET answered from control("signals")');
    assert.match(r.out, /CTS: up/);
    const sets = devices.ops('setSignals').map((c) => c.args);
    assert.ok(sets.some((s) => s.dataTerminalReady === false), `setSignals: ${JSON.stringify(sets)}`);
  },

  async 'a dialout member without sudo gets EACCES and picocom says so'({ run, devices }) {
    const r = await run(['picocom', '-b', '115200', '/dev/ttyUSB0'], { user: 'cone', cwd: '/home/cone' });
    assert.equal(r.status, 1, show(r));
    assert.match(r.stderr, /FATAL: cannot open \/dev\/ttyUSB0: Permission denied/, show(r));
    assert.equal(devices.ops('open').length, 0, 'the hook is never asked');
  },

  async 'the by-id link opens the same node, and a second open is EBUSY'({ kernel, run, devices, until }) {
    const dec = new TextDecoder();
    let out = '';
    const t = await kernel.openTerminal(['sudo', 'picocom', '-b', '115200', '/dev/serial/by-id/usb-0403_6001-if00'], { cwd: '/root' });
    t.onData = (b) => {
      out += dec.decode(b, { stream: true });
    };
    await until('the first picocom', () => /Terminal ready/.test(out));
    assert.equal(devices.ops('open')[0].path, '/dev/ttyUSB0', JSON.stringify(devices.ops('open')));
    const second = await run(['sudo', 'picocom', '-b', '9600', '/dev/ttyUSB0']);
    assert.equal(second.status, 1, show(second));
    assert.match(second.stderr, /FATAL: cannot open \/dev\/ttyUSB0: Device or resource busy/, show(second));
    assert.equal(devices.ops('open').length, 1);
    t.write(`${CA}\x18`);
    assert.equal(await t.exited, 0, out);
    assert.deepEqual(bauds(devices), [115200, 9600], 'the second picocom never configured the port');
  },

  async 'negative: a group-writable node lets the dialout member in, so the mode is the guard'({ kernel, pty, devices }) {
    await kernel.devices.add({ path: 'ttyUSB1', owner: 0, group: 'dialout', mode: 0o660 });
    const r = await pty(['picocom', '-b', '115200', '/dev/ttyUSB1'], {
      user: 'cone',
      cwd: '/home/cone',
      steps: [{ expect: 'Terminal ready' }, { write: `${CA}\x18` }, { expect: 'Thanks for using picocom' }],
    });
    assert.equal(r.status, 0, show(r));
    assert.deepEqual(devices.ops('open').map((o) => [o.path, o.uid > 0]), [['/dev/ttyUSB1', true]]);
  },

  async 'a missing node is ENOENT'({ run, devices }) {
    const r = await run(['sudo', 'picocom', '/dev/ttyUSB1']);
    assert.equal(r.status, 1, show(r));
    assert.match(r.stderr, /FATAL: cannot open \/dev\/ttyUSB1: No such file or directory/, show(r));
    assert.equal(devices.ops('open').length, 0);
  },

  async 'picocom --help and --version run'({ run }) {
    const v = await run(['picocom', '--version'], { user: 'cone', cwd: '/home/cone' });
    assert.equal(v.status, 0, show(v));
    assert.equal(v.stdout, 'picocom v2024-07\n');
    const h = await run(['picocom', '--help'], { user: 'cone', cwd: '/home/cone' });
    assert.equal(h.status, 0, show(h));
    assert.match(h.stdout, /HIGH_BAUD is enabled\n\nUsage is: picocom \[options\] <tty port device>/);
    assert.doesNotMatch(h.stdout, /USE_FLOCK|LINENOISE|USE_CUSTOM_BAUD|UUCP_LOCK_DIR/);
    assert.match(h.stdout, /--<b>aud <baudrate>/);
    const s = await run(['picocom', '--send-cmd', 'sz', '/dev/ttyUSB0'], { user: 'cone', cwd: '/home/cone' });
    assert.notEqual(s.status, 0, show(s));
    assert.match(s.stderr, /Calling external programs is disabled/, show(s));
  },
};

cases['negative: a port that does not echo shows nothing typed'].boot = { loop: false };

const harness = await serialHarness({ root, tarball: args.tarball, needsInstall: meta.needsInstall, kernelSpec: args.kernel });
try {
  const passed = await runCases(harness, cases, { only: args.only, label: 'picocom serial' });
  console.log(`picocom serial: PASS ${passed.length} cases on slicc-kernel ${harness.kver} (createNodeKernel, users enforce, a loopback devices hook)`);
} finally {
  harness.cleanup();
}
process.exit(0);
