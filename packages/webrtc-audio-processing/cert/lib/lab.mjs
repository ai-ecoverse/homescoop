export function lab() {
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return (s / 4294967296) * 2 - 1;
    };
  }

  function speech(rate, seconds, seed, pitch) {
    const r = rng(seed);
    const n = Math.round(rate * seconds);
    const x = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const f0 = pitch + 40 * Math.sin(2 * Math.PI * 0.7 * t + seed) + 20 * Math.sin(2 * Math.PI * 2.3 * t);
      phase += (2 * Math.PI * f0) / rate;
      let v = 0;
      for (let h = 1; h <= 20; h++) v += (Math.sin(h * phase) / h) * (1 + 0.5 * Math.sin(2 * Math.PI * 0.3 * h * t + seed));
      v = v * 0.6 + r() * 0.2;
      const env = Math.max(0, Math.sin(2 * Math.PI * 1.5 * t + seed)) ** 0.5 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.21 * t));
      x[i] = 0.15 * v * env;
    }
    return x;
  }

  function room(rate, far, delayMs, gain) {
    const d = Math.round((rate * delayMs) / 1000);
    const taps = [
      [0, 1],
      [Math.round(rate * 0.003), 0.4],
      [Math.round(rate * 0.011), -0.2],
      [Math.round(rate * 0.023), 0.1],
    ];
    const echo = new Float32Array(far.length);
    for (let i = 0; i < far.length; i++) {
      let v = 0;
      for (const [k, g] of taps) {
        const j = i - d - k;
        if (j >= 0) v += g * far[j];
      }
      echo[i] = gain * v;
    }
    return echo;
  }

  function scene(rate, opts = {}) {
    const seconds = opts.seconds ?? 12;
    const delayMs = opts.delayMs ?? 80;
    const far = speech(rate, seconds, 1, 120);
    const echo = room(rate, far, delayMs, opts.gain ?? 0.5);
    const near = new Float32Array(far.length);
    if (opts.talk) {
      const voice = speech(rate, seconds, 7, 210);
      const a = Math.round(opts.talk[0] * rate);
      const b = Math.round(opts.talk[1] * rate);
      for (let i = a; i < b; i++) near[i] = voice[i];
    }
    const noise = rng(99);
    const mic = new Float32Array(far.length);
    for (let i = 0; i < far.length; i++) mic[i] = echo[i] + near[i] + 1e-3 * noise();
    return { rate, delayMs, far, echo, near, mic };
  }

  function bursts(rate, seconds) {
    const r = rng(5);
    const n = Math.round(rate * seconds);
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const on = Math.floor(t * 7) % 3 === 0 ? 0.3 : 0;
      x[i] = on * r() * (0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * t));
    }
    return x;
  }

  function run(canceller, mic, far, chunk) {
    const out = new Float32Array(mic.length);
    for (let i = 0; i < mic.length; i += chunk) {
      out.set(canceller.cancel(mic.subarray(i, i + chunk), far.subarray(i, i + chunk)), i);
    }
    return out;
  }

  function power(x, a, b, lag = 0) {
    let p = 0;
    for (let i = a; i < b; i++) p += x[i + lag] * x[i + lag];
    return p;
  }

  function erle(input, out, a, b, lag) {
    return 10 * Math.log10(power(input, a, b) / Math.max(power(out, a, b, lag), 1e-20));
  }

  function kept(near, out, a, b, lag) {
    let dot = 0;
    for (let i = a; i < b; i++) dot += near[i] * out[i + lag];
    const pn = power(near, a, b);
    const po = power(out, a, b, lag);
    return { gain: dot / pn, corr: dot / Math.sqrt(pn * Math.max(po, 1e-20)) };
  }

  function lagOf(input, out, a, b, max) {
    let best = -Infinity;
    let lag = 0;
    for (let o = 0; o <= max; o++) {
      const k = kept(input, out, a, b, o).corr;
      if (k > best) {
        best = k;
        lag = o;
      }
    }
    return { lag, corr: best };
  }

  function same(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }

  function digest(x) {
    const u = new Uint32Array(x.buffer, x.byteOffset, x.length);
    let h = 2166136261;
    for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619) >>> 0;
    return h.toString(16).padStart(8, '0');
  }

  function echoChecks(s, out, lag) {
    const r = s.rate;
    const n = s.mic.length;
    return {
      erleDb: erle(s.mic, out, 4 * r, n - lag, lag),
      erleFirstDb: erle(s.mic, out, 0, 2 * r, lag),
    };
  }

  function talkChecks(s, out, lag, talk) {
    const r = s.rate;
    const a = Math.round(talk[0] * r);
    const b = Math.round(talk[1] * r);
    const k = kept(s.near, out, a, b, lag);
    return {
      nearGain: k.gain,
      nearCorr: k.corr,
      erleBeforeDb: erle(s.mic, out, 4 * r, a, lag),
      erleAfterDb: erle(s.mic, out, b + r, s.mic.length - lag, lag),
    };
  }

  return { rng, speech, room, scene, bursts, run, power, erle, kept, lagOf, same, digest, echoChecks, talkChecks };
}

export const LIMITS = {
  erleDb: 20,
  apmErleDb: 10,
  delayToleranceMs: 12,
  nearGain: 0.5,
  nearCorr: 0.6,
  talkErleDb: 15,
  vadEchoMax: 0.05,
  vadNearMin: 0.5,
  realtime: 3,
};

export const TALK = [8, 11];
