import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ptySession } from '../../../scripts/browser-cert/context.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = process.argv.slice(2);
const arg = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const tarball = arg('--tarball');
assert.ok(tarball, 'usage: node-kernel.mjs --tarball <package.tgz> [--kernel <spec>] [--modes sync,async] [--specs a.mjs,b.mjs]');
const devKernel = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies['@ai-ecoverse/slicc-kernel'];
const kernelSpec = arg('--kernel') ?? process.env.HOMESCOOP_CERT_KERNEL ?? `@ai-ecoverse/slicc-kernel@${devKernel}`;
const modes = (arg('--modes') ?? 'sync,async').split(',');
const only = arg('--specs')?.split(',');
const meta = JSON.parse(readFileSync(join(here, '../cert/meta.json'), 'utf8'));
const specs = {
  sync: ['checklist.mjs', 'cwd.mjs', 'cwd-node.mjs', 'limits.mjs', 'repl.mjs'],
  async: ['checklist.mjs', 'cwd.mjs', 'limits.mjs', 'repl.mjs'],
};

const work = mkdtempSync(join(tmpdir(), 'wasi-quickjs-node-kernel-'));
const passed = [];
try {
  const sh = (cmd, argv) => execFileSync(cmd, argv, { stdio: ['ignore', 'pipe', 'inherit'] }).toString();
  const pkg = join(work, 'pkg');
  mkdirSync(pkg);
  sh('tar', ['xzf', resolve(tarball), '-C', pkg]);
  const manifest = JSON.parse(readFileSync(join(pkg, 'package/package.json'), 'utf8'));
  const nm = join(work, 'nm');
  mkdirSync(nm);
  sh('npm', ['install', '--prefix', nm, '--no-fund', '--no-audit', '--silent', kernelSpec, ...meta.needsInstall]);
  const kroot = join(nm, 'node_modules/@ai-ecoverse/slicc-kernel');
  const kver = JSON.parse(readFileSync(join(kroot, 'package.json'), 'utf8')).version;
  const { createNodeKernel } = await import(pathToFileURL(join(kroot, 'dist/node.js')).href);
  for (const mode of modes) {
    const options = mode === 'async' ? { blocking: 'async', emscripten: 'kernel' } : {};
    assert.ok(specs[mode], `unknown mode ${mode}`);
    for (const spec of specs[mode].filter((s) => !only || only.includes(s))) {
      const k = await createNodeKernel({ users: 'enforce', ...options });
      try {
        const copyTree = async (src, dest) => {
          for (const e of readdirSync(src)) {
            const p = join(src, e);
            if (statSync(p).isDirectory()) await copyTree(p, `${dest}/${e}`);
            else await k.writeFile(`${dest}/${e}`, readFileSync(p));
          }
        };
        await copyTree(join(pkg, 'package'), `/node_modules/${manifest.name}`);
        for (const need of meta.needsInstall) {
          const name = need.replace(/@[^@]*$/, '');
          await copyTree(join(nm, 'node_modules', name), `/node_modules/${name}`);
        }
        await k.writeFile('/home/.keep', '');
        await k.writeFile('/tmp/.keep', '');
        const dec = new TextDecoder();
        const ctx = {
          packageName: 'wasi-quickjs',
          npmName: manifest.name,
          assert,
          mode,
          run: (argv, o = {}) => k.run(argv, { cwd: o.cwd || '/home', env: o.env || {}, stdin: o.stdin, ...(o.user !== undefined && { user: o.user }) }),
          write: (p, data) => k.writeFile(`/${p.replace(/^\//, '')}`, data),
          read: async (p) => {
            try {
              return dec.decode(await k.readFile(`/${p.replace(/^\//, '')}`));
            } catch {
              return null;
            }
          },
          pty: (argv, o = {}) => ptySession(k, argv, o),
        };
        const { default: run } = await import(pathToFileURL(join(here, '../cert', spec)).href);
        await run(ctx);
        passed.push(`${mode}/${spec}`);
        console.log(`node-kernel: ${mode} ${spec} ok`);
      } catch (err) {
        err.message = `${mode} ${spec} (slicc-kernel ${kver}): ${err.message}`;
        throw err;
      } finally {
        k.terminate();
      }
    }
  }
  console.log(`wasi-quickjs node-kernel: PASS ${passed.length} specs on slicc-kernel ${kver} (${modes.map((m) => (m === 'async' ? "createNodeKernel({ blocking: 'async' })" : 'createNodeKernel()')).join(', ')})`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(0);
