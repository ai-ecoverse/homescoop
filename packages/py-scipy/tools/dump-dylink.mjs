#!/usr/bin/env node
// dump-dylink.mjs <file.so>... — print dylink.0 NEEDED (sub 2) + RUNTIME_PATH (sub 5)
import fs from 'node:fs';

function readLeb(buf, i) {
  let r = 0, s = 0;
  for (;;) {
    const b = buf[i++];
    r |= (b & 0x7f) << s;
    if (!(b & 0x80)) return [r, i];
    s += 7;
  }
}

function parseDylink(buf) {
  if (buf[0] !== 0 || buf[1] !== 0x61 || buf[2] !== 0x73 || buf[3] !== 0x6d)
    throw new Error('not wasm');
  let i = 8;
  const out = { needed: [], runtimePath: [], memorySize: null, tableSize: null };
  while (i < buf.length) {
    const id = buf[i++];
    let size;
    [size, i] = readLeb(buf, i);
    const payload = buf.subarray(i, i + size);
    i += size;
    if (id !== 0) continue;
    let j = 0, nlen;
    [nlen, j] = readLeb(payload, j);
    const name = Buffer.from(payload.subarray(j, j + nlen)).toString();
    j += nlen;
    if (name !== 'dylink.0') continue;
    while (j < payload.length) {
      const sub = payload[j++];
      let slen;
      [slen, j] = readLeb(payload, j);
      const end = j + slen;
      if (sub === 1) {
        // meminfo: memory_size, memory_align, table_size, table_align
        let v;
        [v, j] = readLeb(payload, j); out.memorySize = v;
        [v, j] = readLeb(payload, j);
        [v, j] = readLeb(payload, j); out.tableSize = v;
        [v, j] = readLeb(payload, j);
      } else if (sub === 2) {
        let count;
        [count, j] = readLeb(payload, j);
        for (let k = 0; k < count; k++) {
          let l;
          [l, j] = readLeb(payload, j);
          out.needed.push(Buffer.from(payload.subarray(j, j + l)).toString());
          j += l;
        }
      } else if (sub === 5) {
        let count;
        [count, j] = readLeb(payload, j);
        for (let k = 0; k < count; k++) {
          let l;
          [l, j] = readLeb(payload, j);
          out.runtimePath.push(Buffer.from(payload.subarray(j, j + l)).toString());
          j += l;
        }
      } else {
        j = end;
      }
    }
    return out;
  }
  return null;
}

for (const f of process.argv.slice(2)) {
  const d = parseDylink(fs.readFileSync(f));
  if (!d) {
    console.log(`${f}: no dylink.0`);
    continue;
  }
  console.log(`${f}:`);
  console.log(`  NEEDED: ${JSON.stringify(d.needed)}`);
  console.log(`  RUNTIME_PATH: ${JSON.stringify(d.runtimePath)}`);
}
