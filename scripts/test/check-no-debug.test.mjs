import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowlisted, arMembers, debugIn, scan, stripArchive } from '../check-no-debug.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'check-no-debug.mjs');
const leb = (n) => {
  const out = [];
  do {
    let b = n & 127;
    n >>>= 7;
    if (n) b |= 128;
    out.push(b);
  } while (n);
  return out;
};
const custom = (name, payload) => {
  const body = [...leb(name.length), ...Buffer.from(name), ...payload];
  return [0, ...leb(body.length), ...body];
};
const wasm = (...sections) => Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 1, 4, 1, 0x60, 0, 0, ...sections.flat()]);
const ar = (members) => {
  const parts = [Buffer.from('!<arch>\n')];
  for (const [name, data] of members) {
    const h = `${`${name}/`.padEnd(16)}${'0'.padEnd(12)}${'0'.padEnd(6)}${'0'.padEnd(6)}${'644'.padEnd(8)}${String(data.length).padEnd(10)}\`\n`;
    parts.push(Buffer.from(h, 'latin1'), data);
    if (data.length & 1) parts.push(Buffer.from('\n'));
  }
  return Buffer.concat(parts);
};

const dbg = wasm(custom('name', [1, 2, 3]), custom('.debug_info', Array(40).fill(7)), custom('.debug_str', Array(9).fill(1)));
const clean = wasm(custom('name', [1, 2, 3]));

test('debugIn finds .debug_* custom sections in a module and in archive members, not the name section', () => {
  assert.deepEqual(debugIn(clean), []);
  assert.deepEqual(debugIn(dbg).map((s) => [s.name, s.size]), [['.debug_info', 40], ['.debug_str', 9]]);
  const a = ar([['a.o', dbg], ['b.o', clean], ['c.o', Buffer.from('not wasm')]]);
  assert.deepEqual(arMembers(a).map((m) => m.name), ['a.o', 'b.o', 'c.o']);
  assert.deepEqual(debugIn(a).map((s) => `${s.member} ${s.name}`), ['a.o .debug_info', 'a.o .debug_str']);
  assert.deepEqual(debugIn(Buffer.from('#!/bin/sh\n')), []);
});

function fixture(fn, recipe = '') {
  const dir = mkdtempSync(join(tmpdir(), 'check-no-debug-'));
  try {
    const pkg = join(dir, 'package');
    mkdirSync(join(pkg, 'bin'), { recursive: true });
    mkdirSync(join(pkg, 'lib'), { recursive: true });
    writeFileSync(join(pkg, 'bin', 'tool.wasm'), dbg);
    writeFileSync(join(pkg, 'lib', 'libx.a'), ar([['x.o', dbg]]));
    writeFileSync(join(pkg, 'bin', 'ok.wasm'), clean);
    return fn({ dir, pkg, recipe });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('scan reports each file with DWARF and its byte count', () => {
  fixture(({ pkg }) => {
    assert.deepEqual(scan(pkg).map((f) => [f.file, f.bytes, f.members]).sort(), [['bin/tool.wasm', 49, 0], ['lib/libx.a', 49, 1]]);
  });
});

test('the allowlist names a recipe with an issue, and a bad line fails', () => {
  assert.equal(allowlisted('wasix-sysroot', 'wasix-sysroot #908 wasixcc builds\n'), '#908');
  assert.equal(allowlisted('grep', 'wasix-sysroot #908 wasixcc builds\n'), null);
  assert.throws(() => allowlisted('grep', 'grep because\n'), /not "<recipe> #<issue> <reason>"/);
});

test('the CLI fails on DWARF, and --strip removes it with the objcopy it is given', () => {
  fixture(({ dir, pkg }) => {
    const fail = spawnSync(process.execPath, [script, 'no-such-recipe', pkg], { encoding: 'utf8' });
    assert.equal(fail.status, 1, fail.stdout + fail.stderr);
    assert.match(fail.stderr, /2 file\(s\) ship 98 bytes of DWARF \(homescoop#908\)/);
    const tool = join(dir, 'fake-objcopy');
    writeFileSync(tool, `#!/usr/bin/env node\nconst fs = require('fs');\nconst [, , flag, src, dst] = process.argv;\nif (flag !== '--strip-debug') process.exit(3);\nconst b = fs.readFileSync(src);\nfs.writeFileSync(dst, b.subarray(0, 0).length ? b : (b.toString('latin1', 0, 8) === '!<arch>\\n' ? ${JSON.stringify(ar([['x.o', clean]]).toString('base64'))} : ${JSON.stringify(clean.toString('base64'))}), 'base64');\n`);
    chmodSync(tool, 0o755);
    const strip = spawnSync(process.execPath, [script, 'no-such-recipe', pkg, '--strip'], { encoding: 'utf8', env: { ...process.env, HOMESCOOP_OBJCOPY: tool } });
    assert.equal(strip.status, 0, strip.stdout + strip.stderr);
    assert.match(strip.stdout, /stripped bin\/tool\.wasm: 49 bytes/);
    assert.match(strip.stdout, /stripped lib\/libx\.a: 49 bytes/);
    assert.deepEqual(readFileSync(join(pkg, 'bin', 'tool.wasm')), clean);
    const ok = spawnSync(process.execPath, [script, 'no-such-recipe', pkg], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /no \.debug_\* sections/);
  });
});

test('--strip refuses an objcopy that drops the name section (or any other non-debug section)', () => {
  fixture(({ dir, pkg }) => {
    const tool = join(dir, 'bad-objcopy');
    const bare = wasm();
    writeFileSync(tool, `#!/usr/bin/env node\nrequire('fs').writeFileSync(process.argv[4], Buffer.from(${JSON.stringify(bare.toString('base64'))}, 'base64'));\n`);
    chmodSync(tool, 0o755);
    const r = spawnSync(process.execPath, [script, 'no-such-recipe', pkg, '--strip'], { encoding: 'utf8', env: { ...process.env, HOMESCOOP_OBJCOPY: tool } });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /also dropped name; only \.debug_\* may go/);
    assert.deepEqual(readFileSync(join(pkg, 'bin', 'tool.wasm')), dbg, 'the file is left as it was');
  });
});

test('stripArchive rewrites members in place, nested archives too, and moves the GNU symbol table offsets with them', () => {
  const nested = ar([['n.o', dbg]]);
  const body = [['a.o', dbg], ['b.o', clean], ['inner.a', nested]];
  const offsets = [];
  let p = 8 + 60 + 4 + 4 * 3 + 6;
  for (const [, d] of body) {
    offsets.push(p);
    p += 60 + d.length + (d.length & 1);
  }
  const sym = Buffer.alloc(4 + 4 * 3);
  sym.writeUInt32BE(3, 0);
  offsets.forEach((o, i) => sym.writeUInt32BE(o, 4 + 4 * i));
  const symtab = Buffer.concat([sym, Buffer.from('a\0b\0n\0', 'latin1')]);
  const a = ar([['', symtab], ...body]);
  const stripped = stripArchive(a, (b) => clean);
  assert.deepEqual(debugIn(stripped), []);
  const members = arMembers(stripped);
  assert.deepEqual(members.map((m) => m.name), ['a.o', 'b.o', 'inner.a']);
  assert.deepEqual(members[0].data, clean);
  assert.deepEqual(debugIn(members[2].data), []);
  const table = stripped.subarray(8 + 60, 8 + 60 + 4 + 12);
  let q = 8;
  const starts = [];
  while (q + 60 <= stripped.length) {
    starts.push(q);
    const size = parseInt(stripped.toString('latin1', q + 48, q + 58).trim(), 10);
    q += 60 + size + (size & 1);
  }
  assert.deepEqual([1, 2, 3].map((i) => table.readUInt32BE(4 * i)), starts.slice(1), 'each symbol points at its member header after the rewrite');
});
