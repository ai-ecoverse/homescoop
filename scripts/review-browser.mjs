#!/usr/bin/env node
/**
 * The review-browser hook of slicc-shared-web's pipeline (ladder-build.yml's
 * `review-browser`). The pipeline runs it four times, once per review browser,
 * in that side's tree, with SLICC_REVIEW_SIDE (head | base), SLICC_REVIEW_LINK
 * (extension | cli), SLICC_REVIEW_CDP (the browser's http://127.0.0.1:<port>)
 * and SLICC_ARTIFACTS (this run's host-<recipe>-prN artifacts).
 *
 * Each browser gets one slicc-kernel page (scripts/browser-cert/page, the cert
 * harness's page) with the packages this pull request built installed:
 *   head: the pull request's own package.tgz, the bytes that get published;
 *   base: the same names from npm (the recipe's npm-tag, else latest), the baseline.
 * The extension browser boots the cert kernel (root package.json's
 * @ai-ecoverse/slicc-kernel), the cli browser slicc-kernel's npm latest.
 * Peers each recipe's cert/meta.json `needs`, plus wasm-bash and
 * wasm-coreutils for a shell, come from npm and are installed first.
 *
 * The pipeline runs it from the head's checkout for both sides
 * (node "$GITHUB_WORKSPACE/scripts/review-browser.mjs"), in the side's tree
 * as the working directory, so a base from before this script still gets
 * its browsers: the side's tree (the cwd) gives the recipes' cert/meta.json
 * and npm-tag and the cert kernel, and this script's own checkout gives the
 * harness page and the spec context.
 *
 * It starts a detached server (`review-browser.mjs serve <plan.json>`) that
 * serves the page, drives the browser over CDP, and then answers the cert
 * spec context (ctx.run, ctx.write, ctx.read, ctx.pty, …) over HTTP, as the
 * cert harness's --live mode does. It writes
 * $RUNNER_TEMP/review/homescoop/<side>-<link>.json, and always exits 0: a
 * browser it can't set up is reported there, and the review goes on.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeContext } from './browser-cert/context.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

export const SIDES = ['head', 'base'];
export const LINKS = ['extension', 'cli'];
export const SHELL = ['@ai-ecoverse/wasm-bash', '@ai-ecoverse/wasm-coreutils'];
export const ARTIFACT = /^host-(.+)-pr(\d+)$/;
export const READY_MS = 15 * 60 * 1000;

/** The package tarballs this run built: one host-<recipe>-prN directory each. */
export function builtPackages(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, m: ARTIFACT.exec(e.name) }))
    .filter(({ name, m }) => m && existsSync(join(dir, name, 'package.tgz')))
    .map(({ name, m }) => ({ recipe: m[1], pr: Number(m[2]), tgz: join(dir, name, 'package.tgz') }))
    .sort((a, b) => (a.recipe < b.recipe ? -1 : a.recipe > b.recipe ? 1 : 0));
}

/** The kernel a browser boots: the cert kernel for the extension link, npm latest for cli. */
export function kernelFor(link) {
  return link === 'cli' ? { spec: '@ai-ecoverse/slicc-kernel@latest', why: "slicc-kernel's npm latest" } : { local: 'node_modules/@ai-ecoverse/slicc-kernel', why: "the cert kernel (root package.json's pin)" };
}

/** npm specs for the peers: each package's cert/meta.json needs (a matching needsInstall spec wins), and a shell. */
export function peerSpecs(metas, names) {
  const own = new Set(names);
  const specs = new Map();
  for (const meta of metas) {
    for (const need of meta?.needs ?? []) {
      if (own.has(need) || specs.has(need)) continue;
      const pinned = (meta.needsInstall ?? []).find((s) => typeof s === 'string' && s.startsWith(`${need}@`));
      specs.set(need, pinned ?? `${need}@latest`);
    }
  }
  for (const name of SHELL) if (!own.has(name) && !specs.has(name)) specs.set(name, `${name}@latest`);
  return [...specs].map(([name, spec]) => ({ name, spec }));
}

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function manifestOf(tgz) {
  const r = spawnSync('tar', ['-xzOf', tgz, 'package/package.json'], { encoding: 'utf8', maxBuffer: 16 << 20 });
  if (r.status !== 0) throw new Error(`${tgz} has no package/package.json`);
  return JSON.parse(r.stdout);
}

function npmPack(spec, into) {
  mkdirSync(into, { recursive: true });
  const r = spawnSync('npm', ['pack', spec, '--pack-destination', into, '--json', '--silent'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) return { error: (r.stderr || r.stdout || `npm pack ${spec} failed`).trim().split('\n').slice(-1)[0] };
  return { tgz: join(into, JSON.parse(r.stdout)[0].filename) };
}

function untar(tgz, into) {
  mkdirSync(into, { recursive: true });
  const r = spawnSync('tar', ['-xpzf', tgz, '-C', into], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tar -xzf ${tgz}: ${r.stderr}`);
  return join(into, 'package');
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFiles(abs, base));
    else out.push(abs.slice(base.length + 1).split('\\').join('/'));
  }
  return out;
}

function modesOf(base, names) {
  const modes = {};
  for (const name of names) {
    const mode = statSync(join(base, name)).mode & 0o7777;
    if (mode !== 0o644 || name.startsWith('bin/')) modes[name] = mode;
  }
  return modes;
}

function npmTagOf(recipe, tree) {
  const own = existsSync(join(tree, 'scripts/npm-tag.mjs')) ? tree : root;
  const r = spawnSync('node', [join(own, 'scripts/npm-tag.mjs'), recipe], { encoding: 'utf8', cwd: tree });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : 'latest';
}

/** Everything the server needs, resolved in the hook (npm packs, untars). */
export function planBrowser({ side, link, cdp, artifacts, tree = process.cwd(), work }) {
  const built = builtPackages(artifacts);
  const plan = { side, link, cdp, tree, page: join(root, 'scripts', 'browser-cert', 'page'), work, packages: [], peers: [], skipped: [], kernel: null, users: null };
  if (!built.length) return { ...plan, none: `no host-<recipe>-prN artifact in ${artifacts || 'SLICC_ARTIFACTS (unset)'}` };
  const metas = [];
  const names = [];
  built.forEach((b, i) => {
    const manifest = manifestOf(b.tgz);
    names.push(manifest.name);
    const meta = readJson(join(tree, 'packages', b.recipe, 'cert', 'meta.json'), {});
    metas.push(meta);
    if (!plan.users && meta?.users) plan.users = meta.users;
    let tgz = b.tgz;
    let from = `pull request #${b.pr}`;
    if (side === 'base') {
      const tag = npmTagOf(b.recipe, tree);
      const packed = npmPack(`${manifest.name}@${tag}`, join(work, 'npm'));
      if (packed.error) {
        plan.skipped.push({ recipe: b.recipe, name: manifest.name, why: `not on npm under ${tag} (${packed.error})` });
        return;
      }
      tgz = packed.tgz;
      from = `npm ${tag}`;
    }
    const pkgRoot = untar(tgz, join(work, `pkg${i}`));
    const m = readJson(join(pkgRoot, 'package.json'), {});
    plan.packages.push({ recipe: b.recipe, name: m.name, version: m.version, sha256: sha256(tgz), from, root: pkgRoot });
  });
  peerSpecs(metas, names).forEach(({ name, spec }, i) => {
    const packed = npmPack(spec, join(work, 'npm'));
    if (packed.error) {
      plan.skipped.push({ name, why: `peer ${spec}: ${packed.error}` });
      return;
    }
    const pkgRoot = untar(packed.tgz, join(work, `peer${i}`));
    const m = readJson(join(pkgRoot, 'package.json'), {});
    plan.peers.push({ name: m.name, version: m.version, from: `npm ${spec}`, root: pkgRoot });
  });
  const k = kernelFor(link);
  let kernelRoot = k.local ? join(tree, k.local) : null;
  if (k.spec) {
    const packed = npmPack(k.spec, join(work, 'kernel'));
    if (packed.error) throw new Error(`kernel ${k.spec}: ${packed.error}`);
    kernelRoot = untar(packed.tgz, join(work, 'kernel'));
  }
  if (!existsSync(join(kernelRoot, 'dist', 'index.js'))) throw new Error(`${kernelRoot}/dist/index.js missing (npm ci first)`);
  const km = readJson(join(kernelRoot, 'package.json'), {});
  plan.kernel = { name: km.name, version: km.version, why: k.why, dist: join(kernelRoot, 'dist') };
  return plan;
}

const ISOLATION = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin',
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm' };

/** Maps a URL path to a file under the first matching root, never outside it. */
export function locator(roots) {
  const mounted = roots.map(([prefix, dir]) => [prefix, `${resolve(dir)}${sep}`]);
  return (pathname) => {
    const found = mounted.find(([prefix]) => pathname.startsWith(prefix));
    if (!found) return null;
    const [prefix, dir] = found;
    const rel = pathname.slice(prefix.length);
    const file = join(dir, normalize(rel === '' || rel.endsWith('/') ? `${rel}index.html` : rel));
    return file.startsWith(dir) ? file : null;
  };
}

function staticServer(roots) {
  const locate = locator(roots);
  const server = createServer(async (req, res) => {
    const file = locate(decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    const info = file && existsSync(file) ? statSync(file) : null;
    if (!info?.isFile()) return res.writeHead(404, ISOLATION).end();
    res.writeHead(200, { ...ISOLATION, 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-length': info.size, 'cache-control': 'no-cache' });
    createReadStream(file).pipe(res);
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(`http://127.0.0.1:${server.address().port}/`)));
}

async function cdpSession(cdp, log) {
  const version = await (await fetch(new URL('/json/version', cdp))).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    ws.onopen = done;
    ws.onerror = () => fail(new Error(`CDP ${cdp}: no connection`));
  });
  ws.onclose = () => {
    log('the browser closed its CDP connection; stopping');
    process.exit(0);
  };
  let id = 0;
  const waiting = new Map();
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && waiting.has(msg.id)) {
      const { done, fail } = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) fail(new Error(`${msg.error.message} (${msg.error.code})`));
      else done(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') log(`exception: ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text}`);
    else if (msg.method === 'Runtime.consoleAPICalled') log(`console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((done, fail) => {
      waiting.set(++id, { done, fail });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return { send, version };
}

/** A harness-style page for makeContext: evaluate(fn, ...args) in the page, awaited, by value. */
export function cdpPage(send, sessionId) {
  const errors = [];
  return {
    errors,
    async evaluate(fn, ...args) {
      const r = await send('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) {
        const why = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text;
        errors.push(why);
        throw new Error(why);
      }
      return r.result?.value;
    },
  };
}

async function serve(planFile) {
  const plan = readJson(planFile);
  const statusFile = join(dirname(planFile), '..', `${plan.side}-${plan.link}.json`);
  const logFile = join(plan.work, 'page.log');
  const log = (line) => writeFileSync(logFile, `${new Date().toISOString()} ${line}\n`, { flag: 'a' });
  const status = { side: plan.side, link: plan.link, cdp: plan.cdp, state: 'starting', kernel: plan.kernel, users: plan.users, packages: plan.packages, peers: plan.peers, skipped: plan.skipped, log: logFile };
  const write = (more) => writeFileSync(statusFile, `${JSON.stringify(Object.assign(status, more), null, 2)}\n`);
  try {
    const installs = [...plan.peers, ...plan.packages].map((p) => ({ ...p, dir: `node_modules/${p.name}/` }));
    const page = await staticServer([['/dist/', plan.kernel.dist], ...installs.map((p) => [`/${p.dir}`, p.root]), ['/', plan.page]]);
    const { send } = await cdpSession(plan.cdp, log);
    const { targetId } = await send('Target.createTarget', { url: page });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId);
    const view = cdpPage(send, sessionId);
    const until = Date.now() + 120000;
    while (!(await view.evaluate(() => typeof window.boot === 'function').catch(() => false))) {
      if (Date.now() > until) throw new Error('the page never defined window.boot');
      await new Promise((r) => setTimeout(r, 500));
    }
    await view.evaluate((o) => window.boot(o), plan.users ? { users: plan.users } : {});
    for (const p of installs) {
      const names = listFiles(p.root);
      await view.evaluate((d, n, m) => window.installTree(d, n, m), p.dir, names, modesOf(p.root, names));
      log(`installed ${p.name}@${p.version} (${names.length} files)`);
    }
    const main = plan.packages.at(-1);
    const ctx = makeContext(view, { packageName: main?.recipe ?? '', npmName: main?.name ?? '' });
    const calls = Object.keys(ctx).filter((k) => k !== 'assert' && typeof ctx[k] === 'function');
    const answer = (res, code, body) => res.writeHead(code, { 'content-type': 'application/json' }).end(`${JSON.stringify(body)}\n`);
    const api = createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/') return answer(res, 200, status);
      const name = req.url.match(/^\/ctx\/([A-Za-z]+)$/)?.[1];
      if (req.method !== 'POST' || !calls.includes(name)) return answer(res, 404, { error: 'GET / or POST /ctx/<call> with a JSON array of arguments', calls });
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        const args = body.trim() ? JSON.parse(body) : [];
        if (!Array.isArray(args)) throw new Error('the body must be a JSON array of arguments');
        answer(res, 200, (await ctx[name](...args)) ?? null);
      } catch (err) {
        answer(res, 500, { error: String(err?.message ?? err) });
      }
    });
    const ctxUrl = await new Promise((done) => api.listen(0, '127.0.0.1', () => done(`http://127.0.0.1:${api.address().port}/`)));
    write({ state: 'ready', page, targetId, ctx: ctxUrl, calls });
    log(`ready: page ${page}, ctx ${ctxUrl}`);
  } catch (err) {
    log(`error: ${err?.stack ?? err}`);
    write({ state: 'error', error: String(err?.message ?? err) });
    process.exit(1);
  }
}

async function hook(env) {
  const side = env.SLICC_REVIEW_SIDE;
  const link = env.SLICC_REVIEW_LINK;
  const temp = env.RUNNER_TEMP || tmpdir();
  const out = join(temp, 'review', 'homescoop');
  const key = `${side}-${link}`;
  const statusFile = join(out, `${key}.json`);
  const work = join(out, key);
  mkdirSync(work, { recursive: true });
  const say = (line) => console.log(`review-browser: ${key}: ${line}`);
  const done = (status) => {
    writeFileSync(statusFile, `${JSON.stringify(status, null, 2)}\n`);
    say(status.state === 'ready' ? `ready, ${status.packages.map((p) => `${p.name}@${p.version}`).join(', ')} on ${status.kernel.name}@${status.kernel.version}, ctx ${status.ctx}` : `${status.state}: ${status.error ?? status.why}`);
  };
  if (!SIDES.includes(side) || !LINKS.includes(link) || !env.SLICC_REVIEW_CDP) {
    return done({ side, link, state: 'error', error: 'needs SLICC_REVIEW_SIDE (head|base), SLICC_REVIEW_LINK (extension|cli) and SLICC_REVIEW_CDP' });
  }
  let plan;
  try {
    plan = planBrowser({ side, link, cdp: env.SLICC_REVIEW_CDP, artifacts: env.SLICC_ARTIFACTS || join(temp, 'review', 'artifacts'), work });
  } catch (err) {
    return done({ side, link, cdp: env.SLICC_REVIEW_CDP, state: 'error', error: String(err?.message ?? err) });
  }
  if (plan.none) return done({ side, link, cdp: plan.cdp, state: 'none', why: plan.none });
  if (!plan.packages.length) return done({ side, link, cdp: plan.cdp, state: 'none', why: 'no built package is on this side', skipped: plan.skipped });
  const planFile = join(work, 'plan.json');
  writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
  const fd = openSync(join(work, 'server.log'), 'a');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve', planFile], { cwd: plan.tree, detached: true, stdio: ['ignore', fd, fd] });
  child.unref();
  closeSync(fd);
  const until = Date.now() + READY_MS;
  while (Date.now() < until) {
    const now = readJson(statusFile);
    if (now?.state === 'ready' || now?.state === 'error') return done(now);
    if (child.exitCode !== null && child.exitCode !== 0 && !now) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return done({ ...(readJson(statusFile) ?? {}), side, link, cdp: plan.cdp, state: 'error', error: `not ready after ${READY_MS / 60000} min; see ${join(work, 'server.log')}` });
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  if (process.argv[2] === 'serve') await serve(resolve(process.argv[3]));
  else await hook(process.env);
}
