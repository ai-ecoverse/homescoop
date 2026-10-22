import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function tarball() {
  if (process.env.CERT_TARBALL) return process.env.CERT_TARBALL;
  const i = process.argv.indexOf('--tarball');
  return i >= 0 ? process.argv[i + 1] : '.homescoop-out/package.tgz';
}

function manifest(tgz) {
  const buf = gunzipSync(readFileSync(tgz));
  for (let at = 0; at + 512 <= buf.length; ) {
    const h = buf.subarray(at, at + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const prefix = str(345, 500);
    const name = (prefix ? `${prefix}/` : '') + str(0, 100);
    const size = parseInt(str(124, 136).trim() || '0', 8);
    if (name === 'package/package.json') return JSON.parse(buf.subarray(at + 512, at + 512 + size).toString('utf8'));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`no package/package.json in ${tgz}`);
}

const TOOLS = {
  xzgrep: ['@ai-ecoverse/wasm-bash', '@ai-ecoverse/wasm-coreutils', '@ai-ecoverse/wasm-grep', '@ai-ecoverse/wasm-sed'],
  xzdiff: ['@ai-ecoverse/wasm-bash', '@ai-ecoverse/wasm-coreutils', '@ai-ecoverse/wasm-diffutils', '@ai-ecoverse/wasm-sed'],
  xzless: ['@ai-ecoverse/wasm-bash', '@ai-ecoverse/wasm-less'],
};

export default async function (ctx) {
  const { run, assert } = ctx;
  const pkg = manifest(tarball());
  const meta = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'meta.json'), 'utf8'));
  const deps = pkg.dependencies ?? {};
  const commands = pkg.slicc?.commands ?? {};
  for (const [cmd, tools] of Object.entries(TOOLS)) {
    assert.deepEqual(commands[cmd], { script: `bin/${cmd}` }, `${cmd} is a slicc.commands script entry: ${JSON.stringify(commands[cmd])}`);
    for (const tool of tools) assert.ok(deps[tool], `${cmd} needs ${tool}, but package.json's dependencies are ${JSON.stringify(pkg.dependencies ?? null)}`);
  }
  for (const [name, spec] of Object.entries(deps)) {
    assert.match(spec, /^\d+\.\d+\.\d+-\d+$/, `${name} is pinned exactly, not ${spec}`);
  }
  const declared = Object.entries(deps).map(([name, spec]) => `${name}@${spec}`).sort();
  assert.deepEqual([...meta.needsInstall].sort(), declared, "the cert installs exactly package.json's dependencies, so the scripts run with only what a user gets");
  assert.deepEqual([...meta.needs].sort(), Object.keys(deps).sort(), "cert/meta.json's needs are package.json's dependencies");
  for (const tool of ['bash', 'grep', 'sed', 'diff', 'less', 'mktemp', 'expr']) {
    const r = await run(['bash', '--norc', '-c', `command -v ${tool}`], { cwd: '/tmp' });
    assert.equal(r.status, 0, `${tool} is on PATH with only the declared dependencies installed: ${r.stderr}`);
  }
  console.log(`deps: xzgrep, xzdiff and xzless are script commands; package.json pins ${declared.join(', ')}, and the cert installs exactly those (homescoop#1487)`);
}
