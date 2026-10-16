import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { LIMITS, TALK, lab } from './lab.mjs';

const L = lab();
const RATES = [16000, 48000];
const LATENCY = { 16000: [288, 384], 48000: [910, 1198] };

let work;
let api;
let nodeApi;
let wasmBytes;
let manifest;
let dir;

function packageDir() {
  if (process.env.WAP_PACKAGE) return resolve(process.env.WAP_PACKAGE);
  const tgz = resolve(process.env.WAP_TGZ || '.homescoop-out/package.tgz');
  work = mkdtempSync(join(tmpdir(), 'wap-cert-'));
  const r = spawnSync('tar', ['-xzf', tgz, '-C', work], { encoding: 'utf8' });
  assert.equal(r.status, 0, `tar -xzf ${tgz}: ${r.stderr}`);
  return join(work, 'package');
}

before(async () => {
  dir = packageDir();
  manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  api = await import(pathToFileURL(join(dir, 'index.js')).href);
  nodeApi = await import(pathToFileURL(join(dir, 'node.js')).href);
  wasmBytes = readFileSync(join(dir, 'dist/webrtc-audio-processing.wasm'));
});

after(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

function make(rate, extra = {}) {
  return nodeApi.create({ sampleRate: rate, ...extra });
}

describe('the package', () => {
  test('exports the API index.d.ts declares, and the wasm imports only what index.js provides', () => {
    assert.equal(manifest.name, '@ai-ecoverse/wasm-webrtc-audio-processing');
    assert.equal(typeof api.instantiate, 'function');
    assert.equal(typeof api.create, 'function');
    assert.equal(typeof nodeApi.create, 'function');
    assert.equal(typeof nodeApi.wasmModule, 'function');
    assert.equal(nodeApi.instantiate, api.instantiate);
    const m = new WebAssembly.Module(wasmBytes);
    const imports = WebAssembly.Module.imports(m).map((i) => `${i.module}.${i.name}`).sort();
    assert.deepEqual(imports, [
      'env.emscripten_notify_memory_growth',
      'wasi_snapshot_preview1.clock_time_get',
      'wasi_snapshot_preview1.fd_close',
      'wasi_snapshot_preview1.fd_seek',
      'wasi_snapshot_preview1.fd_write',
    ]);
    const src = readFileSync(join(dir, 'index.js'), 'utf8');
    for (const word of ['fetch(', 'importScripts', 'await ', 'require(', 'import(']) assert.ok(!src.includes(word), `index.js uses ${word}`);
  });

  test('instantiates synchronously from a Module, an ArrayBuffer and a Uint8Array', () => {
    const module = new WebAssembly.Module(wasmBytes);
    const buffer = wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength);
    for (const source of [module, buffer, new Uint8Array(wasmBytes)]) {
      const inst = api.instantiate(source);
      assert.equal(typeof inst.then, 'undefined');
      const c = inst.create({ sampleRate: 16000 });
      assert.equal(c.frameSize, 160);
      assert.ok(c.cancel(new Float32Array(128), new Float32Array(128)) instanceof Float32Array);
      c.destroy();
    }
    const c = api.create({ wasm: module, sampleRate: 48000 });
    assert.equal(c.frameSize, 480);
    c.destroy();
    assert.throws(() => api.create({ sampleRate: 16000 }), TypeError);
  });

  test('refuses bad options, and a destroyed canceller', () => {
    assert.throws(() => make(44100), RangeError);
    assert.throws(() => make(16000, { noiseSuppression: 'loud' }), RangeError);
    assert.throws(() => make(16000, { vad: 4 }), RangeError);
    const c = make(16000);
    assert.throws(() => c.cancel([0], new Float32Array(1)), TypeError);
    assert.throws(() => c.cancel(new Float32Array(4), new Float32Array(4), new Float32Array(2)), TypeError);
    c.destroy();
    c.destroy();
    assert.throws(() => c.cancel(new Float32Array(1), new Float32Array(1)), /destroyed/);
    assert.throws(() => c.stats(), /destroyed/);
  });

  test('a thousand cancellers come and go on one instance without the memory growing', () => {
    const inst = api.instantiate(nodeApi.wasmModule());
    const quantum = new Float32Array(480).fill(0.01);
    const cycle = () => {
      const c = inst.create({ sampleRate: 48000, noiseSuppression: true, vad: true });
      c.cancel(quantum, quantum);
      c.destroy();
    };
    for (let i = 0; i < 50; i++) cycle();
    const before = inst.memory.buffer.byteLength;
    for (let i = 0; i < 1000; i++) cycle();
    assert.equal(inst.memory.buffer.byteLength, before, 'wasm memory grew over 1000 create/destroy cycles');
    const kept = [];
    for (let i = 0; i < 100; i++) kept.push(inst.create({ sampleRate: 48000, noiseSuppression: true, vad: true }));
    assert.ok(inst.memory.buffer.byteLength > before, 'live cancellers take no memory');
    for (const c of kept) c.destroy();
  });
});

for (const rate of RATES) {
  describe(`${rate} Hz`, () => {
    test(`cancel() lags its input by latencySamples (${LATENCY[rate][0]}; ${LATENCY[rate][1]} with noise suppression), whatever the chunking`, () => {
      const x = L.bursts(rate, 4);
      const silent = new Float32Array(x.length);
      for (const [ns, want] of [[false, LATENCY[rate][0]], [true, LATENCY[rate][1]]]) {
        const c = make(rate, { noiseSuppression: ns });
        assert.equal(c.latencySamples, want);
        const out = L.run(c, x, silent, 128);
        c.destroy();
        const found = L.lagOf(x, out, rate, 3 * rate, Math.round(rate * 0.05));
        assert.equal(found.lag, want, `measured lag ${found.lag}`);
        assert.ok(found.corr > 0.9, `corr ${found.corr}`);
      }
      const s = L.scene(rate, { seconds: 3 });
      const outs = [128, 333, 480, s.mic.length].map((chunk) => {
        const c = make(rate);
        const out = L.run(c, s.mic, s.far, chunk);
        c.destroy();
        return out;
      });
      for (const o of outs.slice(1)) assert.ok(L.same(outs[0], o), 'output depends on the chunk size');
      const c = make(rate);
      const inPlace = Float32Array.from(s.mic);
      for (let i = 0; i < inPlace.length; i += 128) c.cancel(inPlace.subarray(i, i + 128), s.far.subarray(i, i + 128), inPlace.subarray(i, i + 128));
      c.destroy();
      assert.ok(L.same(outs[0], inPlace), 'cancel(mic, ref, mic) differs');
    });

    test(`a delayed, attenuated echo is cancelled: ERLE >= ${LIMITS.erleDb} dB measured, AEC3's own >= ${LIMITS.apmErleDb} dB`, () => {
      const s = L.scene(rate);
      const c = make(rate);
      assert.deepEqual([c.stats().delayMs, c.stats().erleDb], [null, null]);
      const t0 = performance.now();
      const out = L.run(c, s.mic, s.far, 128);
      const speed = (s.mic.length / rate) / ((performance.now() - t0) / 1000);
      const st = c.stats();
      c.destroy();
      const m = L.echoChecks(s, out, c.latencySamples);
      console.log(`${rate} Hz: ERLE ${m.erleDb.toFixed(1)} dB (first 2 s ${m.erleFirstDb.toFixed(1)} dB), stats ${JSON.stringify(st)}, ${speed.toFixed(1)}x realtime`);
      assert.ok(m.erleDb >= LIMITS.erleDb, `ERLE ${m.erleDb.toFixed(1)} dB`);
      assert.ok(st.erleDb >= LIMITS.apmErleDb, `stats().erleDb ${st.erleDb}`);
      assert.equal(st.errors, 0);
      assert.equal(st.referenceDropped, 0);
      assert.equal(st.referenceShort, 0);
      assert.ok(speed >= LIMITS.realtime, `${speed.toFixed(1)}x realtime`);
    });

    test(`the delay estimate is within ${LIMITS.delayToleranceMs} ms of the echo path's (40, 80, 160, 300 ms)`, () => {
      for (const delayMs of [40, 80, 160, 300]) {
        const s = L.scene(rate, { delayMs, seconds: 8 });
        const c = make(rate);
        const out = L.run(c, s.mic, s.far, 128);
        const st = c.stats();
        c.destroy();
        assert.ok(st.delayMs !== null && Math.abs(st.delayMs - delayMs) <= LIMITS.delayToleranceMs, `echo at ${delayMs} ms: delayMs ${st.delayMs}`);
        const m = L.echoChecks(s, out, c.latencySamples);
        assert.ok(m.erleDb >= LIMITS.erleDb, `echo at ${delayMs} ms: ERLE ${m.erleDb.toFixed(1)} dB`);
      }
    });

    test(`double talk keeps the near end (gain >= ${LIMITS.nearGain}, corr >= ${LIMITS.nearCorr}) and the echo stays cancelled around it`, () => {
      for (const ns of [false, true]) {
        const s = L.scene(rate, { talk: TALK, seconds: 14 });
        const c = make(rate, { noiseSuppression: ns });
        const out = L.run(c, s.mic, s.far, 128);
        c.destroy();
        const m = L.talkChecks(s, out, c.latencySamples, TALK);
        console.log(`${rate} Hz double talk${ns ? ' (ns)' : ''}: ${JSON.stringify(m)}`);
        assert.ok(m.nearGain >= LIMITS.nearGain, `near-end gain ${m.nearGain.toFixed(3)}`);
        assert.ok(m.nearCorr >= LIMITS.nearCorr, `near-end corr ${m.nearCorr.toFixed(3)}`);
        assert.ok(m.erleBeforeDb >= LIMITS.talkErleDb, `ERLE before ${m.erleBeforeDb.toFixed(1)} dB`);
        assert.ok(m.erleAfterDb >= LIMITS.talkErleDb, `ERLE after ${m.erleAfterDb.toFixed(1)} dB`);
      }
    });

    test('the VAD sees the near end and not the cancelled echo', () => {
      const s = L.scene(rate, { talk: TALK });
      const c = make(rate, { vad: true });
      const f = c.frameSize;
      const counts = { echo: [0, 0], near: [0, 0] };
      assert.equal(c.stats().voice, false);
      for (let i = 0; i < s.mic.length; i += f) {
        c.cancel(s.mic.subarray(i, i + f), s.far.subarray(i, i + f));
        const t = (i + f) / rate;
        const k = t > 4 && t < TALK[0] ? 'echo' : t > TALK[0] + 0.1 && t < TALK[1] ? 'near' : null;
        if (k) {
          counts[k][0] += c.stats().voice ? 1 : 0;
          counts[k][1] += 1;
        }
      }
      c.destroy();
      const echo = counts.echo[0] / counts.echo[1];
      const near = counts.near[0] / counts.near[1];
      assert.ok(echo <= LIMITS.vadEchoMax, `voice in ${(echo * 100).toFixed(1)}% of echo-only frames`);
      assert.ok(near >= LIMITS.vadNearMin, `voice in ${(near * 100).toFixed(1)}% of near-end frames`);
      assert.equal(make(rate).stats().voice, null);
    });

    test('a reference that runs ahead or short is queued, and counted', () => {
      const s = L.scene(rate, { seconds: 4 });
      const c = make(rate);
      const n = 128;
      for (let i = 0; i < s.mic.length; i += n) {
        const ref = i === 0 ? new Float32Array(2 * rate) : s.far.subarray(i, i + n);
        c.cancel(s.mic.subarray(i, i + n), ref);
      }
      assert.ok(c.stats().referenceDropped > 0);
      const d = make(rate);
      d.cancel(new Float32Array(2 * d.frameSize), new Float32Array(d.frameSize));
      assert.equal(d.stats().referenceShort, d.frameSize);
      c.destroy();
      d.destroy();
    });
  });
}
