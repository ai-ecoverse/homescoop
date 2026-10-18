import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { tarball: { type: 'string' }, 'wasm-clang': { type: 'string', default: '24.0.0-21' } } });
const root = new URL('../../../', import.meta.url).pathname;
mkdirSync(join(root, '.homescoop-out'), { recursive: true });
const work = mkdtempSync(join(root, '.homescoop-out', 'llvm-emscripten-'));
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) out.push({ p, link: true });
    else if (st.isDirectory()) walk(p, out);
    else out.push({ p, link: false });
  }
  return out;
};
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...opts });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

try {
  execFileSync('tar', ['-xzf', values.tarball, '-C', work]);
  const pkg = join(work, 'package');
  const m = JSON.parse(readFileSync(join(pkg, 'manifest.json'), 'utf8'));
  const pj = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
  check(pj.name === '@ai-ecoverse/llvm-emscripten' && /^24\.0\.0-\d+$/.test(pj.version), `package ${pj.name}@${pj.version}`);
  check(!pj.scripts && !pj.slicc, 'no install scripts, no slicc.commands (a build input)');
  check(m.llvm_commit === 'b158b0ae6c559f87be325b8f427c5588e6a48823', `llvm-project ${m.llvm_commit}`);
  check(m.eh === 'js' && m.config.LLVM_ENABLE_EH === 'OFF' && m.config.LLVM_ENABLE_RTTI === 'OFF' && m.config.LLVM_ENABLE_LTO === 'OFF' && m.config.LLVM_ENABLE_THREADS === 'OFF', 'EH js, no RTTI, no LTO, no threads (manifest)');
  const patchDir = join(root, 'packages/llvm-emscripten/patches');
  const wantPatches = Object.fromEntries(readdirSync(patchDir).filter((f) => f.endsWith('.patch')).sort().map((f) => [f, createHash('sha256').update(readFileSync(join(patchDir, f))).digest('hex')]));
  check(JSON.stringify(m.llvm_patches) === JSON.stringify(wantPatches) && m.llvm_patches['0001-main-executable-emscripten.patch'], `manifest.json records the llvm patches by sha256: ${JSON.stringify(m.llvm_patches)}`);
  check(/128-byte/.test(m.sysroot.sigset_t) && /^[0-9a-f]{64}$/.test(m.wasm_emscripten_patches_sha256), `sysroot sigset_t ${m.sysroot.sigset_t}, wasm-emscripten patches ${m.wasm_emscripten_patches_sha256.slice(0, 12)}…`);
  // homescoop#1098: LLVM Support's regex, BLAKE3 and xxHash notices.
  const notices = existsSync(join(pkg, 'THIRD-PARTY-NOTICES.md')) ? readFileSync(join(pkg, 'THIRD-PARTY-NOTICES.md'), 'utf8') : '';
  const support = readFileSync(join(pkg, 'lib/libLLVMSupport.a'), 'latin1');
  const carried = [['regcomp.c.o', 'Henry Spencer'], ['blake3.c.o', 'BLAKE3'], ['xxhash.cpp.o', 'Yann Collet']].filter(([o]) => support.includes(o));
  check(carried.length === 3 && carried.every(([, marker]) => notices.includes(marker)) && pj.files?.includes('THIRD-PARTY-NOTICES.md'), `THIRD-PARTY-NOTICES.md (in files) has the notices for what libLLVMSupport.a carries: ${carried.map(([o, m]) => `${o} ${notices.includes(m) ? 'ok' : 'MISSING'}`).join(', ') || 'none found'}`);
  const files = walk(pkg);
  check(!files.some((f) => f.link), 'no symlinks');
  const leak = /\/home\/|\/Users\/|\/__w\/|\/private\/var\/|\/private\/tmp\/|\/tmp\/homescoop-/;
  const leaks = files.filter((f) => !f.link && /\.(a|o|h|inc|def|json)$/.test(f.p) && leak.test(readFileSync(f.p, 'latin1'))).map((f) => relative(pkg, f.p));
  check(leaks.length === 0, `no build paths in .a/.o/.h/.inc/.def/.json${leaks.length ? `: ${leaks.slice(0, 5).join(', ')}` : ''}`);
  const tools = ['clang', 'lld', 'llvm-ar', 'llvm-nm', 'llvm-objcopy', 'llvm-symbolizer'];
  check(tools.every((t) => m.tools[t]), `manifest has ${tools.join(', ')}`);
  const missing = tools.flatMap((t) => [...m.tools[t].objects, ...m.tools[t].libs, m.tools[t].driver_cpp]).filter((f) => !existsSync(join(pkg, f)));
  check(missing.length === 0, `every manifest object, library and driver main is in the package${missing.length ? `; missing ${missing.slice(0, 5).join(', ')}` : ''}`);
  const strip = (flags) => flags.filter((f) => f !== '-Wl,--gc-sections' && f !== '--gc-sections');
  const ref = JSON.stringify(strip(m.tools.clang.link_flags));
  check(tools.every((t) => JSON.stringify(strip(m.tools[t].link_flags)) === ref), `the 6 tools have the same link flags (less --gc-sections): ${ref}`);
  const bad = tools.flatMap((t) => m.tools[t].link_flags).filter((f) => f.startsWith('/') || /slicc_spawn|extern-post-js|-sENVIRONMENT|-sEXIT_RUNTIME/.test(f));
  check(bad.length === 0, `link flags have no absolute paths or realm settings${bad.length ? `: ${bad.join(' ')}` : ''}`);
  const want = (t) => (t === 'clang' ? 'InitLLVM X(argc, argv, /*InstallPipeSignalExitHandler=*/true, /*NeedsPOSIXUtilitySignalHandling=*/true)' : 'InitLLVM X(argc, argv)');
  check(tools.every((t) => m.tools[t].init_llvm === want(t)), 'generated driver mains initialize LLVM as multicall.cpp expects');

  const pub = join(work, 'pub');
  mkdirSync(pub);
  execFileSync('npm', ['pack', `@ai-ecoverse/wasm-clang@${values['wasm-clang']}`, '--silent'], { cwd: pub, stdio: ['ignore', 'ignore', 'inherit'] });
  execFileSync('tar', ['-xzf', join(pub, readdirSync(pub).find((f) => f.endsWith('.tgz'))), '-C', pub]);
  const res = (dir) => Object.fromEntries(walk(dir).filter((f) => !relative(dir, f.p).startsWith('lib/')).map((f) => [relative(dir, f.p), sha(f.p)]));
  const a = res(join(pkg, 'lib/clang/24'));
  const b = res(join(pub, 'package/lib/clang/24'));
  const diff = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);
  check(Object.keys(a).length > 200 && diff.length === 0, `lib/clang/24 is file for file the published wasm-clang ${values['wasm-clang']}'s (${Object.keys(a).length} files, its lib/ builtins aside)${diff.length ? `; differ: ${diff.slice(0, 5).join(', ')}` : ''}`);

  const env = execFileSync('bash', [join(root, 'scripts/emscripten-tree.sh'), join(work, 'em')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const tree = /EMSCRIPTEN_TREE=(\S+)/.exec(env)[1].replace(/^'|'$/g, '');
  const config = /EMSCRIPTEN_TREE_CONFIG=(\S+)/.exec(env)[1].replace(/^'|'$/g, '');
  const em = (args) => run('python3', [join(tree, 'em++.py'), ...args], { cwd: pkg, env: { ...process.env, EM_CONFIG: config } });
  const out = join(work, 'out');
  mkdirSync(out);
  writeFileSync(join(out, 'package.json'), '{"type": "commonjs"}\n');
  const node = ['-sENVIRONMENT=node', '-sEXIT_RUNTIME=1', '-sALLOW_MEMORY_GROWTH=1', '-sSTACK_SIZE=8388608', '-sFORCE_FILESYSTEM=1',
    '-sINVOKE_RUN=0', '-sEXPORTED_RUNTIME_METHODS=FS,callMain', `--extern-post-js=${join(root, 'scripts/slicc-node-main.js')}`];
  const sizes = {};
  for (const t of ['clang', 'lld', 'llvm-ar', 'llvm-nm']) {
    const c = em([...m.multicall.args, '-c', m.tools[t].driver_cpp, '-o', join(out, `${t}-main.o`)]);
    check(c.status === 0, `${t}'s generated main compiles with the manifest's multicall flags${c.status ? `\n${c.out.slice(-1500)}` : ''}`);
    const l = em(['-O1', join(out, `${t}-main.o`), ...m.tools[t].objects, ...m.tools[t].libs, ...m.tools[t].system_libs, ...m.tools[t].link_flags, ...node, '-o', join(out, `${t}.js`)]);
    check(l.status === 0, `${t} links from the manifest (objects, libs, link flags)${l.status ? `\n${l.out.slice(-1500)}` : ''}`);
    if (existsSync(join(out, `${t}.wasm`))) sizes[t] = readFileSync(join(out, `${t}.wasm`)).length;
  }
  const tool = (t, args, extra = {}) => run(process.execPath, [join(out, `${t}.js`), ...args], { env: { ...process.env, ...extra } });
  let r = tool('clang', ['--version']);
  check(/^clang version 24\.0\.0git \(https:\/\/github\.com\/llvm\/llvm-project\.git b158b0ae6c559f87be325b8f427c5588e6a48823\)$/m.test(r.out), `clang --version: ${r.out.split('\n')[0]}`);
  console.log(`clang default target: ${(/^Target: (.*)$/m.exec(r.out) || [])[1]}`);
  r = tool('clang', ['-print-targets']);
  check(/wasm32\s+- WebAssembly 32-bit/.test(r.out) && /wasm64\s+- WebAssembly 64-bit/.test(r.out) && !/x86|aarch64|arm\b/.test(r.out), `registered targets are wasm32 and wasm64 only, as published: ${r.out.replace(/\s+/g, ' ').trim()}`);
  // 24.0.0-2 (patches/0001): getMainExecutable resolves argv[0] (through
  // PATH when it has no slash, as in slicc-kernel). Up to 24.0.0-1 it was ""
  // on Emscripten, so clang spawned "" -cc1 ("posix_spawn failed" in
  // slicc-kernel). Under node, argv[0] is the script's absolute path, so the
  // script is preloaded at that path in the in-wasm filesystem.
  writeFileSync(join(out, 'e.c'), 'int e;\n');
  r = run(process.execPath, [join(out, 'clang.js'), '-###', '-v', '--target=wasm32-unknown-unknown', '-c', '/w/e.c'], { env: { ...process.env, SLICC_PRELOAD: `${join(out, 'clang.js')}=${join(out, 'clang.js')},/w/e.c=${join(out, 'e.c')}` } });
  check(r.out.includes(`InstalledDir: ${out}\n`) && r.out.includes(` "${join(out, 'clang.js')}" "-cc1"`), `clang knows its own path: InstalledDir is its directory and -cc1 runs it (24.0.0-1: empty, "" -cc1): ${(/^InstalledDir:.*$/m.exec(r.out) || ['no InstalledDir'])[0].replace(out, '<out>')} | ${(/^ "[^"]*" "-cc1"/m.exec(r.out) || ['no -cc1 line'])[0].replace(out, '<out>')}`);
  r = tool('lld', ['-flavor', 'wasm', '--version']);
  check(/LLD 24\.0\.0/.test(r.out), `lld --version: ${r.out.trim().split('\n')[0]}`);
  writeFileSync(join(out, 's.c'), 'int add(int a, int b) { return a + b; }\nint mul(int a, int b) { return a * b; }\n');
  const exp = (d) => mkdirSync(join(out, d), { recursive: true });
  exp('o1'); exp('o2'); exp('o3');
  r = tool('clang', ['--target=wasm32-unknown-unknown', '-O2', '-nostdlib', '-c', '/w/s.c', '-o', '/w/s.o'], { SLICC_PRELOAD: `/w/s.c=${join(out, 's.c')}`, SLICC_EXPORT_DIR: `/w=${join(out, 'o1')}` });
  check(r.status === 0 && existsSync(join(out, 'o1/s.o')), `clang -O2 -c compiles C to a wasm object${r.status ? `\n${r.out.slice(-800)}` : ''}`);
  r = tool('lld', ['-flavor', 'wasm', '--no-entry', '--export=add', '--export=mul', '/w/s.o', '-o', '/w/s.wasm'], { SLICC_PRELOAD: `/w/s.o=${join(out, 'o1/s.o')}`, SLICC_EXPORT_DIR: `/w=${join(out, 'o2')}` });
  check(r.status === 0 && existsSync(join(out, 'o2/s.wasm')), `lld links it${r.status ? `\n${r.out.slice(-800)}` : ''}`);
  if (existsSync(join(out, 'o2/s.wasm'))) {
    const inst = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(join(out, 'o2/s.wasm'))));
    check(inst.exports.add(40, 2) === 42 && inst.exports.mul(6, 7) === 42, 'the linked module computes add(40, 2) = 42 and mul(6, 7) = 42');
  }
  r = tool('llvm-ar', ['rcs', '/w/libs.a', '/w/s.o'], { SLICC_PRELOAD: `/w/s.o=${join(out, 'o1/s.o')}`, SLICC_EXPORT_DIR: `/w=${join(out, 'o3')}` });
  check(r.status === 0 && existsSync(join(out, 'o3/libs.a')), 'llvm-ar rcs archives the object');
  r = tool('llvm-nm', ['/w/libs.a'], { SLICC_PRELOAD: `/w/libs.a=${join(out, 'o3/libs.a')}` });
  check(/T add/.test(r.out) && /T mul/.test(r.out), `llvm-nm lists T add and T mul: ${r.out.replace(/\s+/g, ' ').trim()}`);
  console.log(`linked sizes at -O1 (bytes): ${JSON.stringify(sizes)}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`llvm-emscripten cert: ${failures.length} failed`);
  process.exit(1);
}
console.log('llvm-emscripten cert: all checks pass');
