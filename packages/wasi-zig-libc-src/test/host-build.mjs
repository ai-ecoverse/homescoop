import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { tarball: { type: 'string' } } });
const root = new URL('../../../', import.meta.url).pathname;
const recipe = JSON.parse(execFileSync(process.execPath, [join(root, 'scripts/read-recipe.mjs'), 'wasi-zig-libc-src', '--json'], { encoding: 'utf8' }));
const v = recipe.version;
const host = { 'linux-x64': ['x86_64-linux', 'linux_x64'], 'darwin-arm64': ['aarch64-macos', 'macos_arm64'] }[`${process.platform}-${process.arch}`];
if (!host) throw new Error(`no host zig pin for ${process.platform}-${process.arch}`);
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const fetch = (url, want, out) => {
  execFileSync('curl', ['-fsSL', '--retry', '3', url, '-o', out]);
  if (sha(out) !== want) throw new Error(`${url}: sha256 ${sha(out)}, want ${want}`);
};
mkdirSync(join(root, '.homescoop-out'), { recursive: true });
const work = mkdtempSync(join(root, '.homescoop-out', 'zls-host-'));
try {
  fetch(`https://ziglang.org/download/${v}/zig-${host[0]}-${v}.tar.xz`, recipe.toolchain[`zig_sha256_${host[1]}`], join(work, 'host.tar.xz'));
  fetch(recipe.source.url.replaceAll('{{version}}', v), recipe.source.sha256, join(work, 'src.tar.xz'));
  mkdirSync(join(work, 'host'));
  execFileSync('tar', ['-xJf', join(work, 'host.tar.xz'), '-C', join(work, 'host'), '--strip-components=1']);
  mkdirSync(join(work, 'src'));
  execFileSync('tar', ['-xJf', join(work, 'src.tar.xz'), '-C', join(work, 'src'), '--strip-components=1', `zig-${v}/lib`]);
  rmSync(join(work, 'src/lib/libc/wasi'), { recursive: true });
  rmSync(join(work, 'src/lib/libc/musl'), { recursive: true });
  mkdirSync(join(work, 'pkg'));
  execFileSync('tar', ['-xzf', values.tarball, '-C', join(work, 'pkg')]);
  cpSync(join(work, 'pkg/package/lib/libc/wasi'), join(work, 'src/lib/libc/wasi'), { recursive: true });
  cpSync(join(work, 'pkg/package/lib/libc/musl'), join(work, 'src/lib/libc/musl'), { recursive: true });
  writeFileSync(join(work, 'm.c'), '#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\nint main(int argc, char **argv) { char *s = malloc(32); strcpy(s, "simd128 libc"); printf("%s %zu argc=%d\\n", s, strlen(s), argc); free(s); return 0; }\n');
  const t0 = Date.now();
  const cc = spawnSync(join(work, 'host/zig'), ['cc', '-target', 'wasm32-wasi', '-mcpu=generic+simd128', '-O2', 'm.c', '-o', 'm.wasm'],
    { cwd: work, encoding: 'utf8', env: { ...process.env, ZIG_LIB_DIR: join(work, 'src/lib'), ZIG_GLOBAL_CACHE_DIR: join(work, 'gc'), ZIG_LOCAL_CACHE_DIR: join(work, 'lc') } });
  if (cc.status !== 0) {
    console.error(cc.stderr);
    throw new Error(`host zig cc against the package's wasi-libc sources: rc ${cc.status}`);
  }
  console.log(`host zig ${v} built wasi-libc (generic+simd128) from the package's sources and linked m.wasm in ${Math.round((Date.now() - t0) / 1000)} s`);
  const mod = new WebAssembly.Module(readFileSync(join(work, 'm.wasm')));
  const bad = WebAssembly.Module.imports(mod).filter((i) => i.module !== 'wasi_snapshot_preview1');
  if (bad.length) throw new Error(`m.wasm imports ${JSON.stringify(bad)}`);
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { readFileSync } from 'node:fs';
    import { WASI } from 'node:wasi';
    const wasi = new WASI({ version: 'preview1', args: ['m', 'x'], returnOnExit: true });
    const inst = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(${JSON.stringify(join(work, 'm.wasm'))})), wasi.getImportObject());
    process.exitCode = wasi.start(inst);
  `], { encoding: 'utf8' });
  if (run.status !== 0 || run.stdout !== 'simd128 libc 12 argc=2\n') throw new Error(`m.wasm under node:wasi: rc ${run.status} stdout ${JSON.stringify(run.stdout)} stderr ${run.stderr}`);
  console.log(`m.wasm runs under node:wasi: ${run.stdout.trim()}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
