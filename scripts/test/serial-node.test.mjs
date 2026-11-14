import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeSerial, parseArgs, runCases, serialHarness } from '../browser-cert/serial-node.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function opened(devices, flags = 2) {
  const port = await devices.hook.open({ path: '/dev/ttyUSB0', flags, stamp: { uid: 0 } });
  return { port, reader: port.readable.getReader(), writer: port.writable.getWriter() };
}

test('fakeSerial loops written bytes back and records the open, the writes and every control call', async () => {
  const devices = fakeSerial();
  const { port, reader, writer } = await opened(devices);
  await writer.write(new TextEncoder().encode('hi\r'));
  const { value } = await reader.read();
  assert.equal(new TextDecoder().decode(value), 'hi\r');
  assert.equal(devices.ports[0].text(), 'hi\r');
  assert.equal(port.control('configure', { baudRate: 115200 }), undefined);
  assert.deepEqual(port.control('signals'), { clearToSend: true, dataCarrierDetect: true, dataSetReady: true, ringIndicator: false });
  port.control('close');
  assert.deepEqual(devices.calls, [
    { op: 'open', path: '/dev/ttyUSB0', flags: 2, uid: 0 },
    { op: 'configure', args: { baudRate: 115200 } },
    { op: 'signals' },
    { op: 'close' },
  ]);
  assert.deepEqual(devices.ops('configure').map((c) => c.args.baudRate), [115200]);
});

test('fakeSerial with the loopback off keeps the writes and returns only what push() gives', async () => {
  const devices = fakeSerial({ loop: false });
  const { reader, writer } = await opened(devices, 0);
  await writer.write(new TextEncoder().encode('quiet'));
  devices.ports[0].push('from-device');
  const { value } = await reader.read();
  assert.equal(new TextDecoder().decode(value), 'from-device');
  assert.equal(devices.ports[0].text(), 'quiet');
  assert.equal(devices.calls[0].flags, 0);
});

test('parseArgs reads --tarball, --kernel and --only', () => {
  assert.deepEqual(parseArgs(['--tarball', 'p.tgz', '--only', 'a,b']), { tarball: 'p.tgz', kernel: undefined, only: ['a', 'b'] });
  assert.deepEqual(parseArgs(['--kernel', '@ai-ecoverse/slicc-kernel@1.186.0']), { tarball: undefined, kernel: '@ai-ecoverse/slicc-kernel@1.186.0', only: undefined });
});

test('runCases boots each case with its own options, terminates it, filters by --only and names the kernel on failure', async () => {
  const booted = [];
  const harness = {
    kver: '9.9.9',
    boot: async (o) => {
      const env = { o, terminated: false, kernel: { terminate: () => (env.terminated = true) } };
      booted.push(env);
      return env;
    },
  };
  const quiet = { log: console.log };
  console.log = () => {};
  try {
    const one = async () => {};
    one.boot = { loop: false };
    const cases = { one, two: async () => {} };
    assert.deepEqual(await runCases(harness, cases, { label: 't' }), ['one', 'two']);
    assert.deepEqual(booted.map((b) => [b.o, b.terminated]), [[{ loop: false }, true], [undefined, true]]);
    assert.deepEqual(await runCases(harness, cases, { only: ['two'], label: 't' }), ['two']);
    const bad = { boom: async () => assert.fail('nope') };
    await assert.rejects(runCases(harness, bad, { label: 't' }), { message: 't boom (slicc-kernel 9.9.9): nope' });
    assert.equal(booted.at(-1).terminated, true);
  } finally {
    console.log = quiet.log;
  }
});

test('serialHarness boots createNodeKernel with the package, a dialout cone and a root:dialout 0640 ttyUSB0 answered by the fake hook', { timeout: 180_000 }, async () => {
  const work = mkdtempSync(join(tmpdir(), 'serial-node-test-'));
  try {
    mkdirSync(join(work, 'package'));
    writeFileSync(join(work, 'package/package.json'), JSON.stringify({ name: '@ai-ecoverse/wasm-fake', version: '1.0.0-1' }));
    writeFileSync(join(work, 'package/hello.txt'), 'hi');
    execFileSync('tar', ['czf', join(work, 'p.tgz'), '-C', work, 'package']);
    const harness = await serialHarness({ root, tarball: join(work, 'p.tgz'), kernelSpec: join(root, 'node_modules/@ai-ecoverse/slicc-kernel') });
    try {
      assert.equal(harness.manifest.name, '@ai-ecoverse/wasm-fake');
      assert.match(harness.kver, /^\d+\.\d+\.\d+$/);
      const env = await harness.boot();
      try {
        assert.equal(new TextDecoder().decode(await env.kernel.readFile('/node_modules/@ai-ecoverse/wasm-fake/hello.txt')), 'hi');
        const cone = (await env.kernel.users.list()).find((u) => u.name === 'cone');
        assert.ok(cone.groups.includes(20), JSON.stringify(cone));
        await assert.rejects(env.kernel.devices.add({ path: 'ttyUSB0' }), /EEXIST/);
        const r = await env.run(['sudo', '-l'], { user: 'cone', cwd: '/home/cone' });
        assert.notEqual(r.status, 0, 'cone is not in sudo');
        const t = await env.pty(['sudo', '-l'], { user: 'cone', cwd: '/home/cone', timeoutMs: 10000 });
        assert.notEqual(t.status, 0, JSON.stringify(t));
        assert.equal((await env.run(['sudo', '-l'])).status, 0, 'root runs sudo, from /root');
        let ok = false;
        await env.until('a flag', () => ok || ((ok = true), false), 1000);
        await assert.rejects(env.until('never', () => false, 50), /timed out waiting for never/);
      } finally {
        env.kernel.terminate();
      }
    } finally {
      harness.cleanup();
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
