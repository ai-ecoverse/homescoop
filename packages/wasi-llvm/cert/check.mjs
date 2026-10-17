import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runWasi } from './smoke/run-wasi.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { values } = parseArgs({ options: { tarball: { type: 'string' }, work: { type: 'string' } } });
const tarball = values.tarball || join(root, '.homescoop-out/package.tgz');
const work = values.work || join(root, '.homescoop-out/cert-wasi-llvm');
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...opts });

const recipe = sh(process.execPath, [join(root, 'scripts/read-recipe.mjs'), 'wasi-llvm', '--field', 'version']).trim();
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
sh('tar', ['-xzf', tarball, '-C', work]);
const pkg = join(work, 'package');
const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
check(manifest.name === '@ai-ecoverse/wasi-llvm', `package name ${manifest.name}`);
check(manifest.version.startsWith(`${recipe}-`), `version ${manifest.version} is ${recipe}-N`);
check(!manifest.scripts, 'no install scripts');
check(!manifest.slicc, 'no slicc.commands (a build input)');

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) out.push({ p, link: true });
    else if (st.isDirectory()) walk(p, out);
    else out.push({ p, link: false, nlink: st.nlink });
  }
  return out;
};
const files = walk(pkg);
check(!files.some((f) => f.link || f.nlink > 1), 'no symlinks or hard links');
const leaks = files.filter((f) => !f.link && /\.(cmake|txt|py|h|def|inc)$|llvm-config$/.test(f.p))
  .filter((f) => /\/home\/runner\/|\/Users\/|\/private\/var\/|\/tmp\/homescoop/.test(readFileSync(f.p, 'latin1')))
  .map((f) => relative(pkg, f.p));
check(leaks.length === 0, `no build-machine paths in text files${leaks.length ? `: ${leaks.slice(0, 5).join(', ')}` : ''}`);

const llvmConfig = (...args) => sh('python3', [join(pkg, 'bin/llvm-config'), ...args]).trim();
check(llvmConfig('--version') === recipe, `llvm-config --version is ${recipe}`);
check(llvmConfig('--targets-built') === 'WebAssembly', 'llvm-config --targets-built is WebAssembly');
check(llvmConfig('--shared-mode') === 'static', 'llvm-config --shared-mode is static');
check(llvmConfig('--host-target') === 'wasm32-unknown-wasip1', 'llvm-config --host-target is wasm32-unknown-wasip1');
check(llvmConfig('--prefix') === realpathSync(pkg), 'llvm-config --prefix follows the install');
const libs = ['LLVMCore', 'LLVMSupport', 'LLVMOption', 'LLVMWebAssemblyCodeGen', 'LLVMWebAssemblyAsmParser', 'LLVMPasses', 'LLVMLTO',
  'clangFrontendTool', 'clangCodeGen', 'clangDriver', 'clangStaticAnalyzerCore', 'lldCommon', 'lldELF', 'lldWasm', 'lldCOFF', 'lldMachO', 'lldMinGW'];
const missing = libs.filter((l) => !existsSync(join(pkg, 'lib', `lib${l}.a`)));
check(missing.length === 0, `static libraries present${missing.length ? `; missing ${missing.join(', ')}` : ''}`);
const linkLibs = llvmConfig('--libs', '--link-static', 'core', 'support', 'webassembly', 'target', 'mc', 'passes', 'option', 'lto').split(/\s+/);
check(linkLibs.every((l) => existsSync(join(pkg, 'lib', `lib${l.replace(/^-l/, '')}.a`))), `llvm-config --libs names ${linkLibs.length} libraries, all in lib/`);

const field = (f) => sh(process.execPath, [join(root, 'scripts/read-recipe.mjs'), 'wasi-llvm', '--field', f]).trim();
const sdkHost = { 'linux-x64': 'linux_x64', 'darwin-arm64': 'macos_arm64' }[`${process.platform}-${process.arch}`];
const sdkPin = { ...process.env, HOMESCOOP_WASI_SDK_VERSION: field('toolchain.wasi-sdk'), HOMESCOOP_WASI_SDK_SHA: field(`toolchain.wasi_sdk_sha256_${sdkHost}`) };
const sdkDir = join(root, '.homescoop-out', sh('bash', [join(root, 'scripts/install-wasi-sdk.sh'), '--name'], { env: sdkPin }).trim());
const sdkEnv = sh('bash', [join(root, 'scripts/install-wasi-sdk.sh'), sdkDir], { stdio: ['ignore', 'pipe', 'inherit'], env: sdkPin });
const sdk = /WASI_SDK_PATH=(\S+)/.exec(sdkEnv)[1].replace(/^'|'$/g, '');
const smokeWasm = join(work, 'smoke.wasm');
const cxx = spawnSync(join(sdk, 'bin/clang++'), [
  '--target=wasm32-wasip1-threads', `--sysroot=${join(sdk, 'share/wasi-sysroot')}`, '-pthread', '-D_WASI_EMULATED_MMAN',
  '-O1', ...llvmConfig('--cxxflags').split(/\s+/).filter(Boolean), `-I${join(pkg, 'include')}`,
  join(root, 'packages/wasi-llvm/cert/smoke/smoke.cpp'), '-o', smokeWasm, `-L${join(pkg, 'lib')}`,
  '-llldWasm', '-llldCommon', ...linkLibs, '-ldl', '-lwasi-emulated-mman',
  '-Wl,--import-memory,--export-memory', '-Wl,--max-memory=4294967296', '-Wl,-z,stack-size=1048576',
], { encoding: 'utf8' });
check(cxx.status === 0, `smoke.cpp links against the package with the pinned wasi-sdk${cxx.status ? `:\n${cxx.stderr.slice(-2000)}` : ''}`);
if (cxx.status === 0) {
  const outDir = join(work, 'out');
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { runWasi } from ${JSON.stringify(join(root, 'packages/wasi-llvm/cert/smoke/run-wasi.mjs'))};
    const r = await runWasi(${JSON.stringify(smokeWasm)}, { args: ['/w/add.o', '/w/add.wasm'], preopens: { '/w': ${JSON.stringify(outDir)} } });
    console.log('exit ' + r.code);
    console.log('imports ' + JSON.stringify([...new Set(r.imports.map((i) => i.module + '.' + i.name))].sort()));
  `], { encoding: 'utf8' });
  const out = r.stdout;
  check(r.status === 0 && /^exit 0$/m.test(out), `smoke.wasm runs under node:wasi (rc ${r.status})${r.status ? `\n${r.stderr.slice(-1500)}` : ''}`);
  check(/^  %2 = add i32 %0, %1$/m.test(out), 'IRBuilder module prints and verifies');
  check(/^object \/w\/add\.o$/m.test(out) && /^linked \/w\/add\.wasm$/m.test(out), 'codegen to an object, then lld::wasm::link');
  const addWasm = join(outDir, 'add.wasm');
  if (existsSync(addWasm)) {
    const inst = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(addWasm)));
    check(inst.exports.add(40, 2) === 42, 'the linked add.wasm computes add(40, 2) = 42');
  } else check(false, 'add.wasm written');
  const imports = /^imports (.*)$/m.exec(out)?.[1];
  if (imports) console.log(`smoke.wasm imports: ${imports}`);
  console.log(`smoke.wasm ${readFileSync(smokeWasm).length} bytes`);
}
rmSync(work, { recursive: true, force: true });
if (failures.length) {
  console.error(`wasi-llvm cert: ${failures.length} failed`);
  process.exit(1);
}
console.log('wasi-llvm cert: all checks pass');
