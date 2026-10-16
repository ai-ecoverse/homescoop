// The driver's response-file reader against clang's own tokenizer
// (homescoop#769): the scan_word/scan_rsp section of the shipped bin/cc (or
// drivers/wasix-driver.sh before a build) runs under sh and bash on fixed and
// seeded random files, and its words must be the ones
// llvm::cl::TokenizeGNUCommandLine gives (ported below from LLVM's
// lib/Support/CommandLine.cpp).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const shipped = join(here, '../package/bin/cc');
const driver = readFileSync(existsSync(shipped) ? shipped : join(here, '../drivers/wasix-driver.sh'), 'latin1');

function tokenizeGNU(src) {
  const ws = (c) => c === ' ' || c === '\t' || c === '\r' || c === '\n';
  const out = [];
  let tok = '';
  let inTok = false;
  for (let i = 0, e = src.length; i !== e; i++) {
    if (!inTok) {
      while (i !== e && ws(src[i])) i++;
      if (i === e) break;
      inTok = true;
    }
    const c = src[i];
    if (i + 1 < e && c === '\\') {
      tok += src[++i];
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i !== e && src[i] !== c) {
        if (src[i] === '\\' && i + 1 !== e) i++;
        tok += src[i++];
      }
      if (i === e) break;
      continue;
    }
    if (ws(c)) {
      out.push(tok);
      tok = '';
      inTok = false;
      continue;
    }
    tok += c;
  }
  if (inTok) out.push(tok);
  return out;
}

const start = driver.indexOf('# A response file (CMake');
const end = driver.indexOf('for a in "$@"; do scan_word "$a" 0; done');
assert.ok(start > 0 && end > start, 'the response-file section of the driver');
const dir = mkdtempSync(join(tmpdir(), 'rsp-tokenize-'));
const harness = join(dir, 'harness.sh');
writeFileSync(harness, `set -eu\nscan_arg() { printf '%s\\0' "$1"; }\nlink_inputs=0\n${driver.slice(start, end)}\nscan_word "@$1" 0\n`, 'latin1');
const shells = ['sh', 'bash'].filter((s) => spawnSync(s, ['-c', 'exit 0']).status === 0);

function words(shell, bytes) {
  const f = join(dir, 'f.rsp');
  writeFileSync(f, bytes);
  const out = execFileSync(shell, [harness, f], { env: { ...process.env, LC_ALL: 'C' } }).toString('latin1');
  return out === '' ? [] : out.slice(0, -1).split('\0');
}
const expected = (bytes) => tokenizeGNU(bytes.subarray(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0).toString('latin1'));
const check = (shell, s) => {
  const bytes = Buffer.isBuffer(s) ? s : Buffer.from(s, 'latin1');
  assert.deepEqual(words(shell, bytes), expected(bytes), `${shell}: ${JSON.stringify(bytes.toString('latin1'))}`);
};

const fixed = [
  'r28.c -o "q {x}.wasm"\n', // #769
  '-DX=$Y r28.c -o "d o.wasm"\n', // #769
  "r28.c\t-o e\\ s\\'c~.wasm\r\n",
  'r28.c -o br{a,b}.wasm\n', // #755
  'r28.c -o "sp ace.wasm"\n',
  "a '' \"\" b\n", // empty quoted words count
  'a "unterminated  quote  \n',
  'trailing\\',
  '"in quote\\',
  'x\\\n-o y\n',
  "'a\"b' \"c'd\" \"e\\\"f\" 'g\\'h'\n",
  "`id` $(id) ; | & < > ( ) * ? [a] ~/x\n",
  '\r\n\r\n  \t ',
  '',
  '\xef\xbb\xbfr28.c -o "bom.wasm"\n',
  'a\x1cb "c\x1ed" \x1d\x02\x1f\x03 e\n', // the placeholder bytes the reader cuts with
];

for (const shell of shells) {
  test(`${shell}: fixed response files read as clang reads them`, () => {
    for (const s of fixed) check(shell, s);
  });
  test(`${shell}: random response files read as clang reads them`, () => {
    let seed = 769;
    const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    const alpha = ['a', 'b', ' ', '  ', '\t', '\n', '\r', '"', "'", '\\', '$', '{', '}', '~', '*', '-o', '.wasm', '\x1c', '\x1e', '\xe9'];
    for (let i = 0; i < 150; i++) {
      let s = '';
      for (let n = rnd(24); n > 0; n--) s += alpha[rnd(alpha.length)];
      check(shell, s);
    }
  });
}

test('a long quoted file is read in reasonable time', () => {
  const s = `${Array.from({ length: 2000 }, (_, i) => `"obj/d ${i}/f.o"`).join(' ')} -o "o {x}.wasm"\n`;
  for (const shell of shells) {
    const t0 = Date.now();
    const w = words(shell, Buffer.from(s, 'latin1'));
    assert.equal(w.length, 2002);
    assert.equal(w.at(-1), 'o {x}.wasm');
    assert.ok(Date.now() - t0 < 20000, `${shell}: ${Date.now() - t0} ms`);
  }
});
