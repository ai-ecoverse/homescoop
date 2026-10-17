import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { tarball: { type: 'string' }, wasm: { type: 'string', default: 'bin/rustc.wasm' } } });
const dir = mkdtempSync(join(tmpdir(), 'homescoop-imports-'));
try {
  execFileSync('tar', ['-xzf', values.tarball, '-C', dir, `package/${values.wasm}`]);
  const mod = new WebAssembly.Module(readFileSync(join(dir, 'package', values.wasm)));
  const imports = WebAssembly.Module.imports(mod);
  const modules = [...new Set(imports.map((i) => i.module))].sort();
  const allowed = new Set(['env', 'wasi', 'wasi_snapshot_preview1', 'wasix_32v1']);
  console.log(`${values.wasm}: ${imports.length} imports from ${modules.join(', ')}`);
  console.log(JSON.stringify(imports.map((i) => `${i.module}.${i.name}:${i.kind}`).sort()));
  const odd = modules.filter((m) => !allowed.has(m));
  const memory = imports.find((i) => i.kind === 'memory');
  if (odd.length || !memory) {
    console.error(`unexpected import modules ${odd.join(', ') || '(none)'}; imported memory ${memory ? 'yes' : 'no'}`);
    process.exit(1);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
