// Shared by run-modes.mjs and run-bench.mjs: unpack a wasix-sysroot tarball,
// build a C program against it with the pinned wasixcc, and run commands on
// slicc-kernel's Node entry.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
export const meta = JSON.parse(readFileSync(join(here, '../cert/meta.json'), 'utf8'));
const sh = (cmd, argv, opts = {}) =>
  execFileSync(cmd, argv, { stdio: ['ignore', 'pipe', 'inherit'], ...opts }).toString();

/** `--name value` from argv, or undefined. */
export function arg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** The pinned wasixcc in `work`, its environment from install-wasixcc.sh. */
export function wasixcc(work) {
  const env = { ...process.env };
  for (const line of sh('bash', [join(root, 'scripts/install-wasixcc.sh'), join(work, 'wasixcc')]).split('\n')) {
    const m = line.match(/^export ([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/\$PATH/, env.PATH);
  }
  return env;
}

/** Unpack a sysroot tarball (a path, or an npm spec to pack) into `dir`. */
export function sysroot(tarball, dir) {
  mkdirSync(dir, { recursive: true });
  let tgz = tarball;
  if (!statSync(tarball, { throwIfNoEntry: false })) {
    tgz = join(dir, sh('npm', ['pack', '--silent', '--pack-destination', dir, tarball]).trim().split('\n').pop());
  }
  sh('tar', ['xzf', tgz, '-C', dir]);
  const prefix = join(dir, 'package');
  for (const v of readdirSync(prefix).filter((d) => d.startsWith('sysroot'))) {
    // wasixcc links from lib/wasm32-wasi; the package ships wasm32-wasip1 only.
    symlinkSync('wasm32-wasip1', join(prefix, v, 'lib/wasm32-wasi'));
  }
  return prefix;
}

/** Build test/<src>.c against `prefix` into a package `pkg` with command `name`. */
export function command(env, prefix, src, pkg, name) {
  mkdirSync(join(pkg, 'bin'), { recursive: true });
  sh('wasixcc', ['-O2', join(here, `${src}.c`), '-o', join(pkg, `bin/${name}.wasm`)], {
    env: { ...env, WASIXCC_SYSROOT_PREFIX: prefix },
  });
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({ name: `wasix-sysroot-${name}`, version: '0.0.0', slicc: { abi: 'wasi', commands: { [name]: { wasm: `bin/${name}.wasm` } } } }),
  );
}

/** A Node kernel (meta.kernel, or a local build in kernelDir) with meta.needs installed. */
export async function kernel(work, kernelDir) {
  const nm = join(work, 'nm');
  mkdirSync(nm, { recursive: true });
  sh('npm', ['install', '--prefix', nm, '--no-fund', '--no-audit', '--silent', ...(kernelDir ? [] : [meta.kernel]), ...(meta.needsInstall || meta.needs)]);
  const kernelRoot = kernelDir ?? join(nm, 'node_modules/@ai-ecoverse/slicc-kernel');
  const { createNodeKernel } = await import(pathToFileURL(join(kernelRoot, 'dist/node.js')).href);
  const k = await createNodeKernel({});
  const copyTree = async (src, dest) => {
    for (const e of readdirSync(src)) {
      const p = join(src, e);
      if (statSync(p).isDirectory()) await copyTree(p, `${dest}/${e}`);
      else await k.writeFile(`${dest}/${e}`, readFileSync(p));
    }
  };
  for (const need of meta.needs) await copyTree(join(nm, 'node_modules', need), `/node_modules/${need}`);
  return {
    kernel: k,
    label: kernelDir ?? meta.kernel,
    install: (pkg) => copyTree(pkg, `/node_modules/${JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).name}`),
    run: (argv, o = {}) => k.run(argv, { cwd: o.cwd || '/home', env: o.env || {}, stdin: o.stdin, ...(o.user !== undefined && { user: o.user }) }),
  };
}
