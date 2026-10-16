import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileLink } from '../../wasm-go/cert/hello.mjs';

const PT_LOAD = 1;
const PF_X = 1;

export default async function hello(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: 'cone' });
  const rootVersion = (await ctx.read('/node_modules/@ai-ecoverse/wasm-go/goroot/VERSION')).split('\n')[0];
  const goVersion = JSON.parse(await ctx.read('/node_modules/@ai-ecoverse/wasm-go-std-linux-amd64/package.json')).slicc.go.version;
  assert.equal(goVersion, rootVersion, 'package.json slicc.go.version is the wasm-go toolchain version it pairs with (homescoop#746)');
  const { cwd } = await compileLink(ctx, {
    std: '/node_modules/@ai-ecoverse/wasm-go-std-linux-amd64/goroot/pkg/linux_amd64',
    env: { GOOS: 'linux', GOARCH: 'amd64' },
    out: 'hello',
  });
  // The exact bytes (ctx.read decodes UTF-8 and damaged them, homescoop#738).
  const elf = await ctx.readBytes(`${cwd}/hello`);
  assert.ok(elf, 'the linker wrote hello');
  assert.deepEqual([...elf.subarray(0, 6)], [0x7f, 0x45, 0x4c, 0x46, 2, 1], 'a 64-bit little-endian ELF');
  assert.ok(elf.length > 1_000_000, `a linked executable (${elf.length} bytes)`);
  assert.equal(elf.readUInt16LE(16), 2, 'e_type ET_EXEC');
  assert.equal(elf.readUInt16LE(18), 62, 'e_machine EM_X86_64');
  const entry = elf.readBigUInt64LE(24);
  const phoff = Number(elf.readBigUInt64LE(32));
  const phentsize = elf.readUInt16LE(54);
  const phnum = elf.readUInt16LE(56);
  assert.ok(phnum > 0 && phoff + phnum * phentsize <= elf.length, `program headers inside the file (${phnum} at ${phoff})`);
  let text = null;
  for (let i = 0; i < phnum; i++) {
    const ph = elf.subarray(phoff + i * phentsize);
    if (ph.readUInt32LE(0) !== PT_LOAD) continue;
    const offset = ph.readBigUInt64LE(8);
    const vaddr = ph.readBigUInt64LE(16);
    const filesz = ph.readBigUInt64LE(32);
    assert.ok(offset + filesz <= BigInt(elf.length), `PT_LOAD ${i} (${offset}+${filesz}) lies inside the ${elf.length}-byte file`);
    if (ph.readUInt32LE(4) & PF_X && entry >= vaddr && entry < vaddr + filesz) text = i;
  }
  assert.ok(text !== null, `e_entry 0x${entry.toString(16)} falls in an executable PT_LOAD segment`);

  // On a linux/amd64 host the cross-linked program runs.
  if (process.platform === 'linux' && process.arch === 'x64') {
    const dir = mkdtempSync(join(tmpdir(), 'go-linux-amd64-'));
    try {
      writeFileSync(join(dir, 'hello'), elf);
      chmodSync(join(dir, 'hello'), 0o755);
      const out = execFileSync(join(dir, 'hello'), { encoding: 'utf8', timeout: 30_000 });
      assert.equal(out, 'hello from go 42 1\n', 'the ELF runs on the linux/amd64 host');
      console.log('hello: the linux/amd64 ELF ran on the host');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } else {
    console.log(`hello: ELF headers checked; not run (host is ${process.platform}/${process.arch})`);
  }
}
