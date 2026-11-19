import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const escape = (p) => p.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);

function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = [];
  for (let k = 0; k < count; k++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(start, start + csize);
    files.push({ name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
  }
  return files;
}

async function moduleSource(ctx, path, version, dir) {
  const r = await fetch(`https://proxy.golang.org/${escape(path)}/@v/${version}.zip`);
  ctx.assert.equal(r.status, 200, `${path}@${version} from proxy.golang.org`);
  const prefix = `${path}@${version}/`;
  let n = 0;
  for (const f of unzip(Buffer.from(await r.arrayBuffer()))) {
    if (!f.name.startsWith(prefix)) continue;
    await ctx.write(`${dir}/${f.name.slice(prefix.length)}`, f.data);
    n++;
  }
  return n;
}

export default async function realModules(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: 'verifier' });
  const home = '/home/verifier';
  const env = { HOME: home, GOPROXY: 'http://proxy.test', GOFLAGS: '' };
  const run = (argv, cwd, extra = {}) => ctx.run(argv, { cwd, user: 'verifier', env: { ...env, ...extra } });
  const out = (r) => `rc=${r.status}\n${r.stdout.slice(0, 3000)}\n${r.stderr.slice(0, 3000)}`;
  await ctx.serve(async (req) => {
    const u = new URL(req.url);
    const r = await fetch(`https://proxy.golang.org${u.pathname}`);
    return { status: r.status, headers: [['content-type', 'application/zip']], body: new Uint8Array(await r.arrayBuffer()) };
  });
  const timed = async (label, argv, cwd, extra) => {
    const t0 = Date.now();
    const r = await run(argv, cwd, extra);
    console.log(`real-modules: ${label}: rc ${r.status} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    return r;
  };

  const okf = `${home}/okf`;
  console.log(`real-modules: okf v0.5.2 source, ${await moduleSource(ctx, 'github.com/okfcli/okf', 'v0.5.2', okf)} files`);
  console.log(`real-modules: okf go.sum yaml line: ${(await ctx.read(`${okf}/go.sum`)).split('\n').find((l) => l.startsWith('gopkg.in/yaml.v3 v3.0.1 '))}`);
  let r = await timed('okf cold build', ['go', 'build', '-x', '-trimpath', '-ldflags', '-s -w -X main.version=0.5.2', './cmd/okf'], okf);
  assert.equal(r.status, 0, out(r));
  console.log(`real-modules: okf downloads: ${r.stderr.split('\n').filter((l) => l.startsWith('go: downloading')).join('; ')}`);
  const first = await ctx.readBytes(`${okf}/okf`);
  console.log(`real-modules: okf .slicc-ok: ${(await ctx.read(`${home}/go/pkg/mod/gopkg.in/yaml.v3@v3.0.1/.slicc-ok`))?.trim()}`);
  r = await run([`${okf}/okf`, 'version'], okf);
  console.log(`real-modules: okf version: ${out(r).replace(/\n/g, ' | ')}`);
  assert.match(r.stdout + r.stderr, /0\.5\.2/, out(r));
  r = await timed('okf warm build', ['go', 'build', '-x', '-trimpath', '-ldflags', '-s -w -X main.version=0.5.2', './cmd/okf'], okf);
  assert.equal(r.status, 0, out(r));
  console.log(`real-modules: okf warm build compiles: ${(r.stderr.match(/\/compile /g) ?? []).length}`);
  const second = await ctx.readBytes(`${okf}/okf`);
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  console.log(`real-modules: okf cold ${sha(first)} ${first.length} bytes, warm ${sha(second)}`);
  assert.equal(sha(first), sha(second), 'byte-identical rebuild');

  const yq = `${home}/yq`;
  console.log(`real-modules: yq v4.54.3 source, ${await moduleSource(ctx, 'github.com/mikefarah/yq/v4', 'v4.54.3', yq)} files`);
  console.log(`real-modules: yq go.sum lines ${(await ctx.read(`${yq}/go.sum`)).trim().split('\n').length}`);
  r = await timed('yq cold build', ['go', 'build', '.'], yq);
  assert.equal(r.status, 0, out(r));
  r = await run([`${yq}/yq`, '--version'], yq);
  console.log(`real-modules: yq --version: ${out(r).replace(/\n/g, ' | ')}`);
  assert.match(r.stdout, /v4\.54\.3/, out(r));
  await ctx.write(`${yq}/t.yaml`, 'a: 1\nb: [x, y]\n');
  r = await run([`${yq}/yq`, '-o', 'json', '.', `${yq}/t.yaml`], yq);
  console.log(`real-modules: yq -o json: ${out(r).replace(/\n/g, ' | ')}`);
  assert.equal(r.status, 0, out(r));
  const mods = (await run(['bash', '-c', `ls -d ${home}/go/pkg/mod/*/* ${home}/go/pkg/mod/*/*/* 2>/dev/null | grep @ | wc -l`], home)).stdout.trim();
  console.log(`real-modules: modules in the cache after yq: ${mods}`);
}
