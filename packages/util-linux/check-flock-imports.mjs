import { readFileSync } from 'node:fs';

const want = ['slicc_execve_js', 'slicc_exec_wait_js', 'slicc_spawn_capture_js'];
const file = process.argv[2];
const names = new Set(WebAssembly.Module.imports(new WebAssembly.Module(readFileSync(file))).map((i) => `${i.module}.${i.name}`));
const missing = want.filter((n) => !names.has(`env.${n}`));
if (missing.length) {
  console.error(`flock-imports: FAIL ${file} lacks env.${missing.join(', env.')}: execve or posix_spawnp is not the slicc shims'`);
  process.exit(1);
}
console.log(`flock-imports: PASS ${file} imports env.${want.join(', env.')}`);
