import { readFileSync, writeFileSync } from 'node:fs';

const [file, ...names] = process.argv.slice(2);
if (!file || !names.length) {
  console.error('usage: drop-exports.mjs <module.wasm> <export>...');
  process.exit(2);
}
const drop = new Set(names);
const buf = readFileSync(file);

function uleb(b, at) {
  let v = 0, shift = 0, p = at, byte;
  do {
    byte = b[p++];
    v += (byte & 0x7f) * 2 ** shift;
    shift += 7;
  } while (byte & 0x80);
  return [v, p];
}

function encode(v) {
  const out = [];
  do {
    let byte = v % 128;
    v = Math.floor(v / 128);
    if (v) byte |= 0x80;
    out.push(byte);
  } while (v);
  return Buffer.from(out);
}

const parts = [buf.subarray(0, 8)];
const dropped = [];
let at = 8;
while (at < buf.length) {
  const id = buf[at];
  const [size, body] = uleb(buf, at + 1);
  const end = body + size;
  if (id !== 7) {
    parts.push(buf.subarray(at, end));
    at = end;
    continue;
  }
  let [count, p] = uleb(buf, body);
  const kept = [];
  for (let i = 0; i < count; i++) {
    const start = p;
    const [len, q] = uleb(buf, p);
    const name = buf.subarray(q, q + len).toString('utf8');
    p = q + len + 1;
    [, p] = uleb(buf, p);
    if (drop.has(name)) dropped.push(name);
    else kept.push(buf.subarray(start, p));
  }
  const payload = Buffer.concat([encode(kept.length), ...kept]);
  parts.push(Buffer.from([7]), encode(payload.length), payload);
  at = end;
}
const missing = names.filter((n) => !dropped.includes(n));
if (missing.length) {
  console.error(`drop-exports: ${file} does not export ${missing.join(', ')}`);
  process.exit(1);
}
const out = Buffer.concat(parts);
new WebAssembly.Module(out);
writeFileSync(file, out);
console.log(`drop-exports: ${file}: removed ${dropped.join(', ')}`);
