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

const show = (r) => `rc=${r.status}${r.failedStep ? ` stuck at ${JSON.stringify(r.failedStep)}` : ''}\n--- out\n${JSON.stringify(r.out).slice(-1500)}`;

const cases = {
  async 'sudo screen /dev/ttyUSB0 115200 echoes through the loopback and C-a \\ quits'({ pty, devices }) {
    const r = await pty(['sudo', 'screen', '/dev/ttyUSB0', '115200'], {
      steps: [
        { sleepMs: 3000, write: 'screen-loop\r' },
        { expect: 'screen-loop' },
        { write: '\x01\\' },
        { expect: 'Really quit' },
        { write: 'y' },
        { expect: 'screen is terminating' },
      ],
      timeoutMs: 20000,
    });
    assert.equal(r.status, 0, show(r));
    assert.equal(devices.ports.length, 1, show(r));
    assert.equal(devices.ports[0].text(), 'screen-loop\r', 'the escape keys never reach the port');
    const opens = devices.ops('open');
    assert.equal(opens.length, 1);
    assert.equal(opens[0].path, '/dev/ttyUSB0');
    assert.equal(opens[0].flags, 2, 'O_RDWR');
    assert.equal(opens[0].uid, 0, 'sudo opens it as root');
    const bauds = devices.ops('configure').map((c) => c.args.baudRate);
    assert.ok(bauds.includes(115200), `configure: ${JSON.stringify(devices.ops('configure'))}`);
    assert.equal(devices.ops('close').length, 1);
  },
};

const harness = await serialHarness({ root, tarball: args.tarball, needsInstall: meta.needsInstall, kernelSpec: args.kernel });
try {
  const passed = await runCases(harness, cases, { only: args.only, label: 'screen serial' });
  console.log(`screen serial: PASS ${passed.length} cases on slicc-kernel ${harness.kver} (createNodeKernel, users enforce, a loopback devices hook)`);
} finally {
  harness.cleanup();
}
process.exit(0);
