import { LIMITS, TALK, lab } from './lib/lab.mjs';

async function inPage(base, labSrc, talkWindow) {
  const L = new Function(`return (${labSrc})`)()();
  const origin = location.origin;
  const api = await import(`${origin}${base}index.js`);
  const bytes = await (await fetch(`${base}dist/webrtc-audio-processing.wasm`)).arrayBuffer();
  const module = await WebAssembly.compile(bytes);
  const processor = `
    import { instantiate } from '${origin}${base}index.js';
    registerProcessor('aec', class extends AudioWorkletProcessor {
      constructor(options) {
        super();
        const o = options.processorOptions;
        this.total = o.total;
        this.done = 0;
        this.sent = false;
        try {
          this.aec = instantiate(o.wasm).create({ sampleRate, noiseSuppression: o.ns });
          this.port.postMessage({ kind: 'env', scope: globalThis.constructor.name, fetch: typeof fetch, importScripts: typeof importScripts, latency: this.aec.latencySamples, source: o.wasm instanceof WebAssembly.Module ? 'module' : 'bytes' });
        } catch (e) {
          this.port.postMessage({ kind: 'error', message: String(e && e.stack || e) });
        }
      }
      process(inputs, outputs) {
        const out = outputs[0][0];
        const input = inputs[0];
        if (!this.aec || !input || input.length < 2) return true;
        this.aec.cancel(input[0], input[1], out);
        this.done += out.length;
        if (!this.sent && this.done >= this.total) {
          this.sent = true;
          this.port.postMessage({ kind: 'stats', stats: this.aec.stats(), frames: this.done });
        }
        return true;
      }
    });`;
  const url = URL.createObjectURL(new Blob([processor], { type: 'text/javascript' }));

  async function render(s, wasm, ns) {
    const n = s.mic.length;
    const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: n, sampleRate: s.rate });
    await ctx.audioWorklet.addModule(url);
    const buf = ctx.createBuffer(2, n, s.rate);
    buf.copyToChannel(s.mic, 0);
    buf.copyToChannel(s.far, 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const node = new AudioWorkletNode(ctx, 'aec', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
      processorOptions: { wasm, total: n - 128, ns },
    });
    const msgs = [];
    let statsSeen;
    const got = new Promise((res) => {
      statsSeen = res;
    });
    node.port.onmessage = (e) => {
      msgs.push(e.data);
      if (e.data.kind === 'stats' || e.data.kind === 'error') statsSeen();
    };
    src.connect(node).connect(ctx.destination);
    src.start(0);
    const rendered = await ctx.startRendering();
    await Promise.race([got, new Promise((res) => setTimeout(res, 5000))]);
    return { out: rendered.getChannelData(0), msgs };
  }

  const results = [];
  for (const rate of [16000, 48000]) {
    const echo = L.scene(rate);
    const a = await render(echo, module, false);
    const b = await render(echo, bytes, false);
    const env = a.msgs.find((m) => m.kind === 'env') || null;
    const envBytes = b.msgs.find((m) => m.kind === 'env') || null;
    const errors = [...a.msgs, ...b.msgs].filter((m) => m.kind === 'error').map((m) => m.message);
    const stats = (a.msgs.find((m) => m.kind === 'stats') || {}).stats || null;
    const main = api.instantiate(module).create({ sampleRate: rate });
    const mainOut = L.run(main, echo.mic, echo.far, 128);
    main.destroy();
    const lag = env ? env.latency : 0;
    const bad = L.poison(echo);
    const p = await render(bad, module, false);
    const pStats = (p.msgs.find((m) => m.kind === 'stats') || {}).stats || null;
    const talk = L.scene(rate, { talk: talkWindow, seconds: 14 });
    const t = await render(talk, module, true);
    const tEnv = t.msgs.find((m) => m.kind === 'env') || null;
    results.push({
      rate,
      env,
      envBytes,
      errors,
      stats,
      echo: L.echoChecks(echo, a.out, lag),
      sameAsBytes: L.same(a.out, b.out),
      sameAsMainThread: L.same(a.out, mainOut),
      digest: L.digest(a.out),
      talk: tEnv ? L.talkChecks(talk, t.out, tEnv.latency, talkWindow) : null,
      talkLatency: tEnv ? tEnv.latency : null,
      poison: { ...L.poisonChecks(bad, p.out, lag), count: bad.count, nonFiniteSamples: pStats ? pStats.nonFiniteSamples : null },
    });
  }
  URL.revokeObjectURL(url);
  return results;
}

export default async function (ctx) {
  const { assert, page, npmName } = ctx;
  const base = `/node_modules/${npmName}/`;
  const results = await page.evaluate(inPage, base, lab.toString(), TALK);
  const latency = { 16000: [288, 384], 48000: [910, 1198] };
  for (const r of results) {
    console.log(`worklet ${r.rate} Hz: ${JSON.stringify({ env: r.env, stats: r.stats, echo: r.echo, talk: r.talk, poison: r.poison, digest: r.digest })}`);
    assert.deepEqual(r.errors, [], `${r.rate} Hz: the processor threw`);
    assert.ok(r.env, `${r.rate} Hz: the processor never reported`);
    assert.equal(r.env.scope, 'AudioWorkletGlobalScope');
    assert.equal(r.env.fetch, 'undefined');
    assert.equal(r.env.importScripts, 'undefined');
    assert.equal(r.env.source, 'module');
    assert.equal(r.envBytes && r.envBytes.source, 'bytes', `${r.rate} Hz: no instance from bytes in the worklet`);
    assert.equal(r.env.latency, latency[r.rate][0]);
    assert.equal(r.talkLatency, latency[r.rate][1]);
    assert.ok(r.sameAsBytes, `${r.rate} Hz: a Module and its bytes give different output`);
    assert.ok(r.sameAsMainThread, `${r.rate} Hz: the worklet's output differs from the same cancellation on the main thread`);
    assert.ok(r.echo.erleDb >= LIMITS.erleDb, `${r.rate} Hz: ERLE ${r.echo.erleDb.toFixed(1)} dB in the worklet`);
    assert.ok(r.stats && r.stats.erleDb >= LIMITS.apmErleDb, `${r.rate} Hz: stats().erleDb ${r.stats && r.stats.erleDb}`);
    assert.ok(r.stats.delayMs !== null && Math.abs(r.stats.delayMs - 80) <= LIMITS.delayToleranceMs, `${r.rate} Hz: delayMs ${r.stats.delayMs} for an 80 ms echo`);
    assert.equal(r.poison.nonFiniteOut, 0, `${r.rate} Hz: ${r.poison.nonFiniteOut} non-finite output samples after NaN/Infinity input (#744)`);
    assert.equal(r.poison.nonFiniteSamples, r.poison.count, `${r.rate} Hz: nonFiniteSamples ${r.poison.nonFiniteSamples}`);
    assert.ok(r.poison.erleAfterDb >= LIMITS.erleDb, `${r.rate} Hz: ERLE ${r.poison.erleAfterDb.toFixed(1)} dB after the non-finite burst`);
    assert.ok(r.talk, `${r.rate} Hz: no double-talk run`);
    assert.ok(r.talk.nearGain >= LIMITS.nearGain, `${r.rate} Hz: near-end gain ${r.talk.nearGain.toFixed(3)} in double talk`);
    assert.ok(r.talk.nearCorr >= LIMITS.nearCorr, `${r.rate} Hz: near-end corr ${r.talk.nearCorr.toFixed(3)} in double talk`);
    assert.ok(r.talk.erleBeforeDb >= LIMITS.talkErleDb, `${r.rate} Hz: ERLE before double talk ${r.talk.erleBeforeDb.toFixed(1)} dB`);
  }
}
