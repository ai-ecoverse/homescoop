// homescoop#1046/#1086 (wasi-zig 0.16.0-17): zig.wasm links wasi-llvm's libLLVMSupport, which compiles
// in Henry Spencer's regex, BLAKE3 and xxHash; THIRD-PARTY-NOTICES.md must
// carry their notices when zig.wasm carries that code.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { tarball: { type: 'string' } } });
const dir = mkdtempSync(join(tmpdir(), 'homescoop-notices-'));
try {
  execFileSync('tar', ['-xzf', values.tarball, '-C', dir, 'package/bin/zig.wasm', 'package/THIRD-PARTY-NOTICES.md', 'package/package.json']);
  const wasm = readFileSync(join(dir, 'package/bin/zig.wasm'));
  const notices = readFileSync(join(dir, 'package/THIRD-PARTY-NOTICES.md'), 'utf8');
  const files = JSON.parse(readFileSync(join(dir, 'package/package.json'), 'utf8')).files ?? [];
  const carries = ['llvm_regcomp', 'llvm_regexec() failed to match', 'llvm_blake3_hasher', 'xxh3_64bits'].filter((m) => wasm.includes(Buffer.from(m)));
  const missing = [['Henry Spencer', 'regex'], ['BLAKE3', 'BLAKE3'], ['Yann Collet', 'xxHash']].filter(([m]) => !notices.includes(m)).map(([, w]) => w);
  console.log(`zig.wasm carries LLVM Support code (${carries.join(', ') || 'none found'}); notices missing: ${missing.join(', ') || 'none'}`);
  if (!carries.length || missing.length || !files.includes('THIRD-PARTY-NOTICES.md')) process.exit(1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
