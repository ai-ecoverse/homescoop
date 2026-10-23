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

const SCOPE = '@ai-ecoverse/';

export default async function (ctx) {
  const { run, assert } = ctx;
  const pkg = manifest(tarball());
  const meta = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'meta.json'), 'utf8'));
  const peers = pkg.peerDependencies ?? {};
  const commands = pkg.slicc?.commands ?? {};
  const nested = Object.entries(pkg.dependencies ?? {}).filter(([name]) => name.startsWith(SCOPE));
  assert.deepEqual(nested, [], `package.json's dependencies name homescoop command packages, so npm nests its own copies under wasm-xz next to the top-level ones (slicc-bios#939): ${JSON.stringify(Object.fromEntries(nested))}`);
  for (const [cmd, tools] of Object.entries(TOOLS)) {
    assert.deepEqual(commands[cmd], { script: `bin/${cmd}` }, `${cmd} is a slicc.commands script entry: ${JSON.stringify(commands[cmd])}`);
    for (const tool of tools) assert.ok(peers[tool], `${cmd} needs ${tool}, but package.json's peerDependencies are ${JSON.stringify(pkg.peerDependencies ?? null)}`);
  }
  const wanted = [...new Set(Object.values(TOOLS).flat())].sort();
  assert.deepEqual(Object.keys(peers).sort(), wanted, 'the peers are exactly the packages the scripts call');
  for (const [name, spec] of Object.entries(peers)) {
    assert.equal(spec, '*', `${name} is peer "*", not ${JSON.stringify(spec)}: npm matches a range against a prerelease-style X.Y.Z-N only on the same X.Y.Z, so any other range rejects the next upstream's -1 with ERESOLVE`);
  }
  for (const [name, m] of Object.entries(pkg.peerDependenciesMeta ?? {})) {
    assert.notEqual(m?.optional, true, `${name} is an optional peer, so an install of wasm-xz alone leaves xzgrep, xzdiff or xzless without it`);
  }
  const pins = new Map(meta.needsInstall.map((s) => [s.slice(0, s.lastIndexOf('@')), s.slice(s.lastIndexOf('@') + 1)]));
  assert.deepEqual([...pins.keys()].sort(), wanted, 'cert/meta.json installs each peer once');
  for (const [name, v] of pins) assert.match(v, /^\d+\.\d+\.\d+-\d+$/, `cert/meta.json pins ${name} exactly, not ${v}`);
  assert.deepEqual([...meta.needs].sort(), wanted, "cert/meta.json's needs are package.json's peerDependencies");
  for (const tool of ['bash', 'grep', 'sed', 'diff', 'less', 'mktemp', 'expr']) {
    const r = await run(['bash', '--norc', '-c', `command -v ${tool}`], { cwd: '/tmp' });
    assert.equal(r.status, 0, `${tool} is on PATH with only the peers installed: ${r.stderr}`);
  }
  console.log(`deps: xzgrep, xzdiff and xzless are script commands; package.json has peers ${wanted.map((n) => `${n}@*`).join(', ')} and no @ai-ecoverse dependencies; the cert installs ${[...pins].map(([n, v]) => `${n}@${v}`).join(', ')} (slicc-bios#939)`);
}
