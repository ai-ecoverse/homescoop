import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRAME = /\(?((?:file:\/\/)?\/[^()\s]+?):(\d+):\d+\)?$/;

function framesIn(stack, roots, base) {
  const out = [];
  for (const line of String(stack || '').split('\n').slice(1)) {
    const m = FRAME.exec(line.trim());
    if (!m) continue;
    const file = m[1].startsWith('file://') ? fileURLToPath(m[1]) : m[1];
    if (roots.some((r) => file.startsWith(r))) out.push(`${relative(base, file)}:${m[2]}`);
  }
  return out;
}

const firstLine = (e) => String(e?.message ?? e).split('\n')[0].slice(0, 300);
const text = (e) => String(e?.message ?? e).slice(0, 1000);

export function signature(message) {
  return String(message ?? '')
    .split('\n')[0]
    .replace(/https?:\/\/[^\s)'"]+/g, 'URL')
    .replace(/\d+/g, 'N')
    .slice(0, 200);
}

export function recorder(base, { soft = false, roots, root }) {
  const seen = new Map();
  const cases = { pass: [], fail: [] };
  let last = null;
  const idOf = () => {
    const site = framesIn(new Error().stack, roots, root).join('<') || 'unknown';
    const n = (seen.get(site) || 0) + 1;
    seen.set(site, n);
    return n > 1 ? `${site}#${n}` : site;
  };
  const failed = (id, err) => {
    cases.fail.push({ id, message: text(err) });
    last = err;
    if (!soft) throw err;
  };
  const check = (fn, args) => {
    const id = idOf();
    let r;
    try {
      r = fn(...args);
    } catch (err) {
      return failed(id, err);
    }
    if (r && typeof r.then === 'function') {
      return r.then(
        (v) => {
          cases.pass.push(id);
          return v;
        },
        (err) => failed(id, err),
      );
    }
    cases.pass.push(id);
    return r;
  };
  const assert = (...args) => check(base, args);
  for (const [k, v] of Object.entries(base)) {
    assert[k] = typeof v === 'function' && /^[a-z]/.test(k) && k !== 'strict' ? (...args) => check(v, args) : v;
  }
  assert.strict = assert;
  return {
    assert,
    cases,
    isAssertion: (err) => err === last,
    crash: (err) => {
      const where = framesIn(err?.stack, roots, root)[0] || null;
      return { where, message: text(err), signature: `${where || '?'} ${signature(firstLine(err))}` };
    },
  };
}
