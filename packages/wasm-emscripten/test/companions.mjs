#!/usr/bin/env node
// The exact wasm-clang and wasm-binaryen a wasm-emscripten tarball pins must
// be the CI builds (homescoop#859): wasm-clang from llvm-emscripten, which
// ships the LLVM Support notices (regex, BLAKE3, xxHash) its llvm.wasm needs,
// and wasm-binaryen relinked against today's shims/slicc (the credential
// library, #459, and the inherited-ignore seed, #973), so emcc's tools see
// the kernel's users and an inherited SIGPIPE ignore.
//   node packages/wasm-emscripten/test/companions.mjs --tarball <package.tgz | npm spec>
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const spec = args[args.indexOf('--tarball') + 1];
if (!args.includes('--tarball') || !spec) {
  console.error('usage: companions.mjs --tarball <wasm-emscripten package.tgz | npm spec>');
  process.exit(2);
}
const work = mkdtempSync(join(tmpdir(), 'wasm-emscripten-companions-'));
const pack = (s) => {
  const p = resolve(s);
  if (statSync(p, { throwIfNoEntry: false })) return p;
  return join(work, execFileSync('npm', ['pack', '--silent', '--pack-destination', work, s]).toString().trim().split('\n').pop());
};
const member = (tgz, f) => execFileSync('tar', ['-xzOf', tgz, `package/${f}`], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
let code = 1;
try {
  const em = JSON.parse(member(pack(spec), 'package.json').toString());
  const clangVer = em.dependencies?.['@ai-ecoverse/wasm-clang'];
  const binVer = em.dependencies?.['@ai-ecoverse/wasm-binaryen'];
  console.log(`== ${em.name}@${em.version} pins wasm-clang ${clangVer}, wasm-binaryen ${binVer}`);
  const problems = [];
  const clang = pack(`@ai-ecoverse/wasm-clang@${clangVer}`);
  let notices = '';
  try {
    notices = member(clang, 'THIRD-PARTY-NOTICES.md').toString();
  } catch {
    problems.push(`wasm-clang ${clangVer} ships no THIRD-PARTY-NOTICES.md`);
  }
  for (const [what, re] of [['the LLVM Support regex notice', /Henry Spencer/], ['BLAKE3', /BLAKE3/], ['xxHash', /xxHash/i]]) {
    if (notices && !re.test(notices)) problems.push(`wasm-clang ${clangVer}'s THIRD-PARTY-NOTICES.md lacks ${what}`);
  }
  const opt = new WebAssembly.Module(member(pack(`@ai-ecoverse/wasm-binaryen@${binVer}`), 'bin/wasm-opt.wasm'));
  const imports = new Set(WebAssembly.Module.imports(opt).map((i) => i.name));
  for (const want of ['slicc_cred_js', 'slicc_sig_inherited_js']) {
    if (!imports.has(want)) problems.push(`wasm-binaryen ${binVer}'s wasm-opt.wasm does not import ${want}`);
  }
  if (problems.length) throw new Error(problems.join('; '));
  console.log(`PASS ${em.name}@${em.version}: wasm-clang ${clangVer} ships the LLVM Support notices; wasm-binaryen ${binVer}'s wasm-opt imports slicc_cred_js and slicc_sig_inherited_js`);
  code = 0;
} catch (e) {
  console.log(`FAIL ${e.message}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(code);
