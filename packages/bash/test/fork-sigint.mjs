import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const arg = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const tarball = arg('--tarball');
const kernelSpec = arg('--kernel') ?? '@ai-ecoverse/slicc-kernel@1.130.2';
const rounds = Number(arg('--rounds') ?? 3);
assert.ok(tarball, 'usage: fork-sigint.mjs --tarball <package.tgz> [--kernel <spec>] [--rounds <n>]');
const sh = (cmd, argv) => execFileSync(cmd, argv, { stdio: ['ignore', 'pipe', 'inherit'] }).toString();
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = (t) => new TextEncoder().encode(t);

const work = mkdtempSync(join(tmpdir(), 'bash-fork-sigint-'));
let k;
let setTestSyscallHook;
try {
  const pkg = join(work, 'pkg');
  mkdirSync(pkg);
  sh('tar', ['xzf', resolve(tarball), '-C', pkg]);
  const nm = join(work, 'nm');
  mkdirSync(nm);
  sh('npm', ['install', '--prefix', nm, '--no-fund', '--no-audit', '--silent', kernelSpec, '@ai-ecoverse/wasm-coreutils']);
  const kroot = join(nm, 'node_modules/@ai-ecoverse/slicc-kernel');
  const kver = JSON.parse(readFileSync(join(kroot, 'package.json'), 'utf8')).version;
  const { createNodeKernel } = await import(pathToFileURL(join(kroot, 'dist/node.js')).href);
  ({ setTestSyscallHook } = await import(pathToFileURL(join(kroot, 'dist/testing.js')).href));
  assert.equal(typeof setTestSyscallHook, 'function', `${kernelSpec} has no setTestSyscallHook (slicc-kernel#1146 ships it)`);
  const bashVer = JSON.parse(readFileSync(join(pkg, 'package/package.json'), 'utf8')).version;
  const results = [];
  for (let round = 0; round < rounds; round++) {
    k = await createNodeKernel({ users: 'enforce' });
    const copyTree = async (src, dest) => {
      for (const e of readdirSync(src)) {
        const p = join(src, e);
        if (statSync(p).isDirectory()) await copyTree(p, `${dest}/${e}`);
        else await k.writeFile(`${dest}/${e}`, readFileSync(p));
      }
    };
    await copyTree(join(pkg, 'package'), '/node_modules/@ai-ecoverse/wasm-bash');
    await copyTree(join(nm, 'node_modules/@ai-ecoverse/wasm-coreutils'), '/node_modules/@ai-ecoverse/wasm-coreutils');
    let out = '';
    const d = new TextDecoder();
    const term = await k.openTerminal(['bash', '--norc', '-i'], { cwd: '/', onData: (b) => (out += d.decode(b, { stream: true })) });
    let exited = null;
    term.exited.then((code) => (exited = code));
    for (let i = 0; i < 1000 && !/[$#] /.test(out); i++) await settle(10);
    let shell;
    let child;
    setTestSyscallHook(async ({ pid, op }) => {
      if (op === 'proc-fork' && shell === undefined) {
        shell = pid;
        term.write(enc('\x03'));
      } else if (shell !== undefined && pid !== shell && child === undefined && op === 'proc-setpgid') {
        child = pid;
        await settle(300);
      }
    });
    term.write(enc('sleep 0.1 && echo ran\r'));
    for (let i = 0; i < 1000 && child === undefined; i++) await settle(10);
    await settle(800);
    setTestSyscallHook(undefined);
    term.write(enc('echo "after"\r'));
    for (let i = 0; i < 1000 && !/[^"]after\r\n/.test(out) && exited === null; i++) await settle(10);
    results.push([child !== undefined, exited, /[^"]after\r\n/.test(out)]);
    assert.deepEqual(results[round], [true, null, true], `round ${round + 1}: [child forked, bash exit, "after" printed]; a ^C at bash's first proc-fork with the child's setpgid held 300 ms must leave bash reading its next line\n${JSON.stringify(out.slice(-400))}`);
    term.close();
    await Promise.race([term.exited.catch(() => undefined), settle(5000)]);
    k.terminate();
    k = undefined;
  }
  console.log(`wasm-bash ${bashVer} on slicc-kernel ${kver} (users enforce): ${rounds} rounds of a ^C at bash's first proc-fork, the child's setpgid held 300 ms: bash keeps the terminal and reads its next line (homescoop#1230)`);
} finally {
  setTestSyscallHook?.(undefined);
  k?.terminate();
  rmSync(work, { recursive: true, force: true });
}
