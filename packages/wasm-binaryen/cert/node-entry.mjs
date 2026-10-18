#!/usr/bin/env node
// wasm-binaryen on slicc-kernel's Node entry (homescoop#276, cert/meta.json
// harness host-node). The tools' glue carries slicc-emscripten's appended
// Node-host runner, which ran main with process.argv whenever `process`
// existed: slicc-kernel's Node process worker exposed it until 1.93.0, so
// every tool ran with no arguments there and the kernel's own callMain
// trapped. From 132.0.0-2 the runner stays out of a host that sets
// noInitialRun, as the kernel does (glue-node-runner.patch).
//
//   node packages/wasm-binaryen/cert/node-entry.mjs --tarball <package.tgz | npm spec> [--kernel <npm spec>]
//
// The glue runs as shipped: every tool answers --version with nothing on
// stderr (132.0.0-1's runner ran a second main with no arguments, which
// printed "Fatal: no graph file provided." and the like), and wasm-as,
// wasm-opt (-O2 and --asyncify, as wasm-clang's cc uses it for fork) and
// wasm-dis work on a module importing wasix_32v1.proc_fork, under users
// enforce, as root and as kernel user cone.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const meta = JSON.parse(readFileSync(join(here, 'meta.json'), 'utf8'));
const args = process.argv.slice(2);
const arg = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!arg('--tarball')) {
  console.error('usage: node-entry.mjs --tarball <package.tgz | npm spec> [--kernel <npm spec>]');
  process.exit(2);
}
const kernelSpec = arg('--kernel') ?? meta.kernel;
const sh = (cmd, argv) => execFileSync(cmd, argv, { stdio: ['ignore', 'pipe', 'inherit'] }).toString();
const GUARD = "if (typeof process !== 'undefined' && process.versions && process.versions.node && !Module['noInitialRun']) {";
const RUNNER = '\n// Node runs the tool immediately.';

const work = mkdtempSync(join(tmpdir(), 'wasm-binaryen-cert-'));
let k;
try {
  let tgz = resolve(arg('--tarball'));
  if (!statSync(tgz, { throwIfNoEntry: false })) {
    tgz = join(work, sh('npm', ['pack', '--silent', '--pack-destination', work, arg('--tarball')]).trim().split('\n').pop());
  }
  sh('tar', ['xzf', tgz, '-C', work]);
  const pkg = join(work, 'package');
  const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
  const tools = Object.keys(manifest.slicc.commands);
  for (const t of tools) {
    const glue = readFileSync(join(pkg, manifest.slicc.commands[t].glue), 'utf8');
    if (glue.includes(RUNNER)) assert.ok(glue.includes(GUARD), `bin/${t}: the Node-host runner has no noInitialRun guard (homescoop#276)`);
    const mod = new WebAssembly.Module(readFileSync(join(pkg, manifest.slicc.commands[t].wasm)));
    const cred = WebAssembly.Module.imports(mod).some((i) => i.name === 'slicc_cred_js') && WebAssembly.Module.exports(mod).some((e) => e.name === 'slicc_cred_euid');
    assert.ok(WebAssembly.Module.imports(mod).some((i) => i.name === 'slicc_sig_inherited_js'), `bin/${t}.wasm lacks shims/slicc's inherited-ignore seed (import slicc_sig_inherited_js, homescoop#973)`);
    const leak = readFileSync(join(pkg, manifest.slicc.commands[t].wasm), 'latin1').match(/\/(?:home|Users|__w|private\/var)\/[\x21-\x7e]{0,80}/);
    assert.equal(leak, null, `bin/${t}.wasm names a build path: ${leak?.[0]}`);
    assert.ok(cred && glue.includes('slicc_cred_js'), `bin/${t}.wasm lacks the slicc credential library (import slicc_cred_js, export slicc_cred_euid; homescoop#459): under users the kernel would show every file it writes as 1000:1000`);
  }
  console.log(`== ${manifest.name}@${manifest.version}: ${tools.length} tools, every glue's runner guarded; ${kernelSpec}, users enforce`);

  const nm = join(work, 'nm');
  mkdirSync(nm, { recursive: true });
  sh('npm', ['install', '--prefix', nm, '--no-fund', '--no-audit', '--silent', kernelSpec]);
  const kroot = join(nm, 'node_modules/@ai-ecoverse/slicc-kernel');
  const kver = JSON.parse(readFileSync(join(kroot, 'package.json'), 'utf8')).version;
  const { createNodeKernel } = await import(pathToFileURL(join(kroot, 'dist/node.js')).href);
  k = await createNodeKernel({ users: 'enforce' });
  const copy = async (src, dest) => {
    for (const e of readdirSync(src)) {
      const p = join(src, e);
      if (statSync(p).isDirectory()) await copy(p, `${dest}/${e}`);
      else await k.writeFile(`${dest}/${e}`, readFileSync(p));
    }
  };
  await copy(pkg, `/node_modules/${manifest.name}`);
  const cone = await k.users.add({ name: 'cone' });
  const run = (argv, o = {}) => k.run(argv, { cwd: o.cwd || '/tmp', env: {}, ...(o.user !== undefined && { user: o.user }) });
  for (let i = 0; ; i++) {
    const r = await run(['wasm-opt', '--version']);
    if (r.status === 0) break;
    if (i >= 50) assert.fail(`wasm-opt --version: rc=${r.status}\n${r.stdout}${r.stderr}`);
    await new Promise((res) => setTimeout(res, 200));
  }
  for (const t of tools) {
    const r = await run([t, '--version']);
    assert.equal(r.status, 0, `${t} --version on slicc-kernel ${kver}: rc=${r.status}\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, new RegExp(`^${t} version 132\\b`), `${t} --version: ${r.stdout}${r.stderr}`);
    // 132.0.0-1's runner ran a second main with no arguments ("Fatal: no graph file provided.", "warning: no passes specified").
    assert.equal(r.stderr, '', `${t} --version printed on stderr (a second main from the Node-host runner?): ${r.stderr}`);
  }
  console.log(`== kernel ${kver} (Node entry): ${tools.map((t) => `${t} --version`).join(', ')} all rc 0, version 132`);

  const wat = '(module\n  (import "wasix_32v1" "proc_fork" (func $fork (result i32)))\n  (memory (export "memory") 1)\n  (func (export "_start")\n    (drop (call $fork))\n    (drop (i32.add (i32.const 1) (i32.const 2)))))\n';
  for (const [user, dir] of [[undefined, '/tmp/bn-root'], [cone.name, `/home/${cone.name}/bn`]]) {
    const who = user ?? 'root';
    const mk = await run(['mkdir', '-p', dir], { user });
    if (mk.status !== 0) await k.writeFile(`${dir}/.keep`, '');
    await k.writeFile(`${dir}/a.wat`, wat);
    const steps = [
      ['wasm-as', 'a.wat', '-o', 'a.wasm'],
      ['wasm-opt', '-O2', 'a.wasm', '-o', 'o2.wasm'],
      ['wasm-opt', '--asyncify', '-O2', '--pass-arg=asyncify-imports@wasix_32v1.proc_fork', 'a.wasm', '-o', 'async.wasm'],
      ['wasm-dis', 'async.wasm', '-o', 'async.wat'],
    ];
    for (const argv of steps) {
      const r = await run(argv, { cwd: dir, user });
      assert.equal(r.status, 0, `${who}: ${argv.join(' ')}: rc=${r.status}\n${r.stdout}${r.stderr}`);
      assert.doesNotMatch(r.stderr, /Fatal|no passes specified|no output file|no input|infile/, `${who}: ${argv.join(' ')}: ${r.stderr}`);
    }
    const mod = new WebAssembly.Module(Buffer.from(await k.readFile(`${dir}/async.wasm`)));
    const exps = WebAssembly.Module.exports(mod).map((e) => e.name);
    assert.ok(exps.includes('asyncify_start_unwind') && exps.includes('asyncify_stop_rewind'), `${who}: async.wasm exports ${exps.join(' ')}`);
    assert.ok(WebAssembly.Module.imports(mod).some((i) => i.module === 'wasix_32v1' && i.name === 'proc_fork'), `${who}: async.wasm lost its proc_fork import`);
    const o2 = new WebAssembly.Module(Buffer.from(await k.readFile(`${dir}/o2.wasm`)));
    assert.ok(!WebAssembly.Module.exports(o2).some((e) => e.name.startsWith('asyncify_')), `${who}: -O2 alone asyncified`);
    const dis = Buffer.from(await k.readFile(`${dir}/async.wat`)).toString();
    assert.match(dis, /\(import "wasix_32v1" "proc_fork"/, dis.slice(0, 400));
    assert.match(dis, /\(export "asyncify_start_unwind"/, dis.slice(0, 400));
    console.log(`== ${who}: wasm-as, wasm-opt -O2, wasm-opt --asyncify (asyncify_* exports, proc_fork kept) and wasm-dis in ${dir}`);
  }
  console.log(`PASS ${manifest.name}@${manifest.version} on slicc-kernel ${kver} (Node entry, glue as shipped)`);
} catch (e) {
  process.exitCode = 1;
  console.log(`FAIL ${e.stack}`);
} finally {
  if (k) await k.terminate();
  rmSync(work, { recursive: true, force: true });
}
