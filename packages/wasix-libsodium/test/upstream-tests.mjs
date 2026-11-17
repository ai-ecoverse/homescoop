#!/usr/bin/env node
// libsodium's own test suite (test/default) against a wasix-libsodium tarball:
// every test with an .exp is compiled with the pinned wasixcc against lib/
// (static-main) and lib-pic/ (dynamic-main), with nothing but that flavour's
// pkg-config flags plus the suite's cmptest.h/quirks.h, linked with
// -Wl,--fatal-warnings, and run as a command on slicc-kernel's Node entry
// (cert/meta.json's kernel). cmptest.h's main writes <test>.res and compares
// it with <test>.exp byte for byte; the test passes when it exits 0.
//
//   node packages/wasix-libsodium/test/upstream-tests.mjs --tarball <package.tgz> [--only a,b] [--kernel-dir <dir>]
//
// The suite comes from the recipe's own source (url + sha256, fetched here),
// so it always matches the version under test.
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, '..');
const root = resolve(pkgDir, '../..');
const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
if (!opt('--tarball')) {
  console.error('usage: upstream-tests.mjs --tarball <package.tgz> [--only a,b] [--kernel-dir <dir>]');
  process.exit(2);
}
const meta = JSON.parse(readFileSync(join(pkgDir, 'cert/meta.json'), 'utf8'));
const recipe = JSON.parse(execFileSync(process.execPath, [join(root, 'scripts/read-recipe.mjs'), 'wasix-libsodium', '--json']).toString());
const work = mkdtempSync(join(tmpdir(), 'wasix-libsodium-upstream-'));
const sh = (cmd, argv, o = {}) => execFileSync(cmd, argv, { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 26, ...o }).toString();
const FLAVOURS = {
  '': { lib: 'lib', env: { WASIXCC_PIC: 'no', WASIXCC_WASM_EXCEPTIONS: 'no', WASIXCC_MODULE_KIND: 'static-main' } },
  '-pic': { lib: 'lib-pic', env: { WASIXCC_PIC: 'yes', WASIXCC_WASM_EXCEPTIONS: 'legacy', WASIXCC_MODULE_KIND: 'dynamic-main' } },
};

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  }));
  return out;
}

let failed = 0;
try {
  sh('tar', ['xzf', resolve(opt('--tarball')), '-C', work]);
  const pkg = join(work, 'package');
  const version = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).homescoop.upstream;
  if (version !== recipe.version) throw new Error(`tarball is libsodium ${version}, the recipe ${recipe.version}`);

  // The suite, from the recipe's pinned source.
  const url = recipe.source.url.replaceAll('{{version}}', recipe.version);
  const tgz = join(work, 'libsodium.tar.gz');
  sh('curl', ['-fsSL', '--retry', '5', '--retry-all-errors', '--retry-delay', '2', url, '-o', tgz]);
  const sha = createHash('sha256').update(readFileSync(tgz)).digest('hex');
  if (sha !== recipe.source.sha256) throw new Error(`${url}: sha256 ${sha}, recipe pins ${recipe.source.sha256}`);
  mkdirSync(join(work, 'src'));
  sh('tar', ['xzf', tgz, '-C', join(work, 'src'), '--strip-components=1']);
  const suite = join(work, 'src/test/default');
  const only = opt('--only')?.split(',');
  const tests = readdirSync(suite).filter((f) => f.endsWith('.exp')).map((f) => f.slice(0, -4))
    .filter((t) => existsSync(join(suite, `${t}.c`)) && (!only || only.includes(t))).sort();
  if (!only && tests.length < 90) throw new Error(`only ${tests.length} tests with an .exp in ${suite}`);
  console.log(`== libsodium ${version}: ${tests.length} tests from test/default`);

  const env = { ...process.env, WASIXCC_RUN_WASM_OPT: 'no' };
  const tc = recipe.toolchain ?? {};
  const sysrootEnv = tc.wasix_sysroot ? { HOMESCOOP_WASIX_SYSROOT_VERSION: tc.wasix_sysroot, HOMESCOOP_WASIX_SYSROOT_SHA: tc.wasix_sysroot_sha256 } : {};
  for (const line of sh('bash', [join(root, 'scripts/install-wasixcc.sh'), join(work, 'wasixcc')], { env: { ...process.env, ...sysrootEnv } }).split('\n')) {
    const m = line.match(/^export ([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/\$PATH/, env.PATH);
  }

  const probes = join(work, 'probes');
  mkdirSync(join(probes, 'bin'), { recursive: true });
  const commands = {};
  const jobs = Math.max(2, availableParallelism());
  const buildFail = [];
  for (const [suffix, f] of Object.entries(FLAVOURS)) {
    const pc = join(pkg, f.lib, 'pkgconfig');
    const flags = sh('pkg-config', ['--cflags', '--libs', '--static', 'libsodium'], {
      env: { ...process.env, PKG_CONFIG_PATH: pc, PKG_CONFIG_LIBDIR: pc, PKG_CONFIG_SYSROOT_DIR: '' },
    }).trim().split(/\s+/).filter(Boolean);
    console.log(`== compile ${tests.length} tests (${f.env.WASIXCC_MODULE_KIND}, ${f.lib}/): ${flags.join(' ').replaceAll(pkg, '<pkg>')}`);
    await pool(tests, jobs, async (t) => {
      const cmd = `${t}${suffix}`;
      try {
        await run('wasixcc', ['-O2', `-DTEST_NAME="${t}"`, '-DTEST_SRCDIR="."', `-I${join(work, 'src/test/quirks')}`,
          join(suite, `${t}.c`), ...flags, '-Wl,--fatal-warnings', '-o', join(probes, `bin/${cmd}.wasm`)],
        { env: { ...env, ...f.env }, maxBuffer: 1 << 24 });
        commands[cmd] = { wasm: `bin/${cmd}.wasm` };
      } catch (e) {
        buildFail.push(`${cmd}: ${String(e.stderr || e.message).trim().split('\n').slice(-5).join(' | ')}`);
      }
    });
  }
  for (const b of buildFail) console.log(`FAIL build ${b}`);
  failed += buildFail.length;
  writeFileSync(join(probes, 'package.json'), JSON.stringify({ name: 'wasix-libsodium-tests', version: '0.0.0', slicc: { abi: 'wasi', commands } }));

  const nm = join(work, 'nm');
  mkdirSync(nm);
  const kernelDir = opt('--kernel-dir') && resolve(opt('--kernel-dir'));
  if (!kernelDir) sh('npm', ['install', '--prefix', nm, '--no-fund', '--no-audit', '--silent', meta.kernel]);
  const kernelRoot = kernelDir ?? join(nm, 'node_modules/@ai-ecoverse/slicc-kernel');
  console.log(`== ${kernelDir ?? meta.kernel} (Node entry)`);
  const { createNodeKernel } = await import(pathToFileURL(join(kernelRoot, 'dist/node.js')).href);
  const kernel = await createNodeKernel({});
  for (const e of readdirSync(probes, { recursive: true })) {
    const p = join(probes, e);
    if (e.endsWith('.wasm') || e === 'package.json') await kernel.writeFile(`/node_modules/wasix-libsodium-tests/${e}`, readFileSync(p));
  }
  // Each test reads ./<test>.exp and writes ./<test>.res in its own directory.
  let passed = 0;
  for (const [suffix] of Object.entries(FLAVOURS)) {
    const cwd = `/tmp/sodium-tests${suffix || '-static'}`;
    for (const t of tests) await kernel.writeFile(`${cwd}/${t}.exp`, readFileSync(join(suite, `${t}.exp`)));
    for (const t of tests) {
      const cmd = `${t}${suffix}`;
      if (!commands[cmd]) continue;
      const t0 = Date.now();
      const r = await kernel.run([cmd], { cwd, env: {} });
      const ms = Date.now() - t0;
      if (r.status === 0) {
        passed++;
        console.log(`PASS ${cmd} (${ms} ms)`);
      } else {
        failed++;
        const res = await kernel.readFile?.(`${cwd}/${t}.res`).catch(() => null);
        console.log(`FAIL ${cmd}: rc=${r.status} (${ms} ms) stdout=${r.stdout.slice(0, 400)} stderr=${r.stderr.slice(0, 400)}${res ? `\n  .res: ${Buffer.from(res).toString().slice(0, 400)}` : ''}`);
      }
    }
  }
  await kernel.terminate();
  console.log(`upstream-tests: ${passed} passed, ${failed} failed (${tests.length} tests x ${Object.keys(FLAVOURS).length} flavours)`);
  if (passed !== tests.length * Object.keys(FLAVOURS).length) failed ||= 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
