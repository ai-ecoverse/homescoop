/**
 * binutils checklist (homescoop#91): strings (the slicc 6 options -n, -t,
 * -a, -e plus the issue's two cases), size and readelf on real ELF objects.
 * Fixtures (fixtures/fixtures.json) are base64: two ELF objects from
 * fixtures/obj.c and mixed.bin, built as
 *   printf '\x00\x01\x02hello world\x00\xff\xfeAB\x00binary-tail-string\n\x03caf\xe9 bar'
 *   + four NULs + "hithere" as UTF-16LE + two NULs.
 * Expected outputs come from GNU binutils 2.47 on the host.
 */
import { readFileSync } from 'node:fs';

const fx = JSON.parse(readFileSync(new URL('./fixtures/fixtures.json', import.meta.url), 'utf8'));
const BASH_WASM = '/node_modules/@ai-ecoverse/wasm-bash/bin/bash.wasm';

export default async function (ctx) {
  const { run, assert } = ctx;
  const cwd = '/home/bu';
  const go = (argv) => run(argv, { cwd });
  const sh = (script) => run(['bash', '-c', script], { cwd });

  const mk = await run(['mkdir', '-p', cwd], { cwd: '/home' });
  assert.equal(mk.status, 0, `mkdir stderr=${mk.stderr}`);
  for (const [name, file] of [['x86_64', 'x86.o'], ['aarch64', 'arm.o'], ['mixed', 'mixed.bin']]) {
    const w = await run(['bash', '-c', `base64 -d > ${file}`], { cwd, stdin: fx[name] });
    assert.equal(w.status, 0, `write ${file} stderr=${w.stderr}`);
  }

  // The issue: strings -n 8 on bash's wasm prints readable strings.
  const there = await go(['test', '-s', BASH_WASM]);
  assert.equal(there.status, 0, `${BASH_WASM} missing or empty`);
  const bash = await go(['strings', '-n', '8', BASH_WASM]);
  assert.equal(bash.status, 0, `strings -n 8 bash.wasm stderr=${bash.stderr}`);
  const lines = bash.stdout.split('\n').slice(0, -1);
  assert.ok(lines.length > 1000, `strings -n 8 bash.wasm: only ${lines.length} lines`);
  assert.ok(lines.some((l) => l.includes('GNU bash, version')), 'no "GNU bash, version" in bash.wasm strings');
  assert.deepEqual(lines.filter((l) => l.length < 8), [], 'strings -n 8 printed a line shorter than 8');

  // The issue: mixed binary and text, only the text comes out.
  const plain = await go(['strings', 'mixed.bin']);
  assert.equal(plain.status, 0, `strings stderr=${plain.stderr}`);
  assert.equal(plain.stdout, 'hello world\nbinary-tail-string\n bar\n');
  const n8 = await go(['strings', '-n', '8', 'mixed.bin']);
  assert.equal(n8.stdout, 'hello world\nbinary-tail-string\n');
  const all = await go(['strings', '-a', 'mixed.bin']);
  assert.equal(all.stdout, plain.stdout, 'strings -a differs from the default whole-file scan');

  // -t x / d / o: offsets.
  const tx = await go(['strings', '-t', 'x', 'mixed.bin']);
  assert.equal(tx.stdout, '      3 hello world\n     14 binary-tail-string\n     2c  bar\n');
  const td = await go(['strings', '-t', 'd', 'mixed.bin']);
  assert.equal(td.stdout, '      3 hello world\n     20 binary-tail-string\n     44  bar\n');
  const to = await go(['strings', '-t', 'o', 'mixed.bin']);
  assert.equal(to.stdout, '      3 hello world\n     24 binary-tail-string\n     54  bar\n');

  // -e s is the 7-bit default; -e S keeps 8-bit bytes (0xff 0xfe, 0xe9).
  const es = await go(['strings', '-e', 's', 'mixed.bin']);
  assert.equal(es.stdout, plain.stdout);
  const eS = await sh("strings -e S mixed.bin | od -An -tx1 -v | tr -d ' \\n'");
  assert.equal(
    eS.stdout,
    '68656c6c6f20776f726c640afffe41420a62696e6172792d7461696c2d737472696e670a636166e9206261720a',
    `strings -e S bytes ${eS.stdout}`,
  );
  const el = await go(['strings', '-e', 'l', 'mixed.bin']);
  assert.equal(el.stdout, 'hithere\n');

  // strings -d reads data sections through BFD (x86-64 ELF target).
  const sd = await go(['strings', '-d', 'x86.o']);
  assert.equal(sd.status, 0, `strings -d stderr=${sd.stderr}`);
  assert.equal(sd.stdout, 'homescoop-binutils-banner\n');

  // size: Berkeley table for both targets, then per-section.
  const size = await go(['size', 'x86.o', 'arm.o']);
  assert.equal(size.status, 0, `size stderr=${size.stderr}`);
  assert.equal(
    size.stdout,
    '   text\t   data\t    bss\t    dec\t    hex\tfilename\n' +
      '     50\t      4\t     16\t     70\t     46\tx86.o\n' +
      '     70\t      4\t     16\t     90\t     5a\tarm.o\n',
    `size ${JSON.stringify(size.stdout)}`,
  );
  const sizeA = await go(['size', '-A', 'x86.o']);
  assert.match(sizeA.stdout, /^\.text +24 +0$/m, `size -A ${sizeA.stdout}`);
  assert.match(sizeA.stdout, /^\.rodata +26 +0$/m);
  assert.match(sizeA.stdout, /^Total +70$/m);

  // readelf: headers and symbols.
  const rh = await go(['readelf', '-h', 'arm.o']);
  assert.equal(rh.status, 0, `readelf -h stderr=${rh.stderr}`);
  assert.match(rh.stdout, /Class:\s+ELF64/);
  assert.match(rh.stdout, /Type:\s+REL \(Relocatable file\)/);
  assert.match(rh.stdout, /Machine:\s+AArch64/);
  const rx = await go(['readelf', '-h', 'x86.o']);
  assert.match(rx.stdout, /Machine:\s+Advanced Micro Devices X86-64/);
  const rs = await go(['readelf', '-sW', 'x86.o']);
  assert.match(rs.stdout, /\s24 FUNC\s+GLOBAL DEFAULT\s+2 greet$/m, `readelf -s ${rs.stdout}`);
  assert.match(rs.stdout, /\s26 OBJECT\s+GLOBAL DEFAULT\s+4 banner$/m);

  // Errors.
  const miss = await go(['strings', 'no-such-file']);
  assert.equal(miss.status, 1, `strings missing rc=${miss.status}`);
  assert.match(miss.stderr, /'no-such-file': No such file/);
  const notObj = await go(['size', 'mixed.bin']);
  assert.notEqual(notObj.status, 0, 'size on a non-object should fail');
  assert.match(notObj.stderr, /mixed\.bin: file format not recognized/);
  const notElf = await go(['readelf', '-h', 'mixed.bin']);
  assert.equal(notElf.status, 1, `readelf non-ELF rc=${notElf.status}`);
  assert.match(notElf.stderr, /Not an ELF file/);
}
