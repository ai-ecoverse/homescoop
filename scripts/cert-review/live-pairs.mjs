#!/usr/bin/env node
/**
 * cert-review's live pairs: a baseline (npm latest, or the recipe's npm-tag)
 * and a head (this pull request's tarball) `browser-cert/run.mjs --live`
 * harness per package, so the reviewer can run the same thing on both sides.
 *
 * Every pair is two Chromes plus the harness, so starting one per package for
 * a 12-package pull request ran the runner out of memory (#1275, run
 * 39290294810). Only the first LIVE_PAIRS_MAX packages (default 4) get a pair
 * up front, in a fixed order: packages that ship a changed binary (a wasm
 * module or a C extension) first, then pure-Python and script packages, then
 * docs-only changes, by name within each. The rest are listed as capped; the
 * reviewer certifies them from ladder-pr's cert jobs and the harness, and can
 * open a pair for one of them on demand (at most ON_DEMAND_MAX at a time).
 *
 *   node live-pairs.mjs up --packages <json> --root <checkout> --tools <dir> --artifacts <dir>
 *       --harness <dir> --live <dir> --pr <n> [--base <sha>] [--max <n>] [--note <file>] [--port <first, 9300>]
 *   node live-pairs.mjs start <package> --live <dir>   # an on-demand pair for a capped package
 *   node live-pairs.mjs stop <package> --live <dir>
 *   node live-pairs.mjs stop-all --live <dir>          # every pair's harness and Chromes
 *
 * `<live>/live.json` lists every pair side (`package`, `side`, `url`, `pid`,
 * `peers_from_pr`, `on_demand`) and every package without a pair
 * (`{ package, live: false, why }`, why `cap`, `stopped` or `harness <name>`).
 */
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const LIVE_PAIRS_MAX = 4;
export const ON_DEMAND_MAX = 2;
export const FIRST_PORT = 9300;

/** Ranks, lowest first: what a live pair is most useful for. */
export const TIERS = ['binary', 'no-binary', 'docs-only'];

const BINARY = /\.(wasm|so|node|a)$|\.so\.\d[\d.]*$/;
// Docs only: no build input (a recipe's libs.txt, CMakeLists.txt or requirements.txt is one) matches.
const DOCS = /(^|\/)(docs\/.*|[^/]*\.(md|markdown|rst)|(README|CHANGELOG|CHANGES|NEWS|LICEN[CS]E|COPYING|AUTHORS|NOTICE)([.-][^/]*)?)$/i;

/**
 * A package's tier, from the files its head tarball ships and the files the
 * pull request changes under packages/<package>/ (null when unknown).
 */
export function tierOf({ files = [], changed = null }) {
  if (Array.isArray(changed) && changed.length && changed.every((f) => DOCS.test(f))) return 'docs-only';
  return files.some((f) => BINARY.test(f)) ? 'binary' : 'no-binary';
}

export function liveMax(value) {
  if (value === undefined || value === null || value === '') return LIVE_PAIRS_MAX;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`LIVE_PAIRS_MAX must be a whole number >= 0, not "${value}"`);
  return n;
}

/**
 * The plan: `candidates` are `{ package, tier, harness }` (harness
 * `slicc-kernel` gets a pair; any other harness, or blocked, never does and
 * isn't counted against the cap).
 */
export function planLivePairs(candidates, { max = LIVE_PAIRS_MAX } = {}) {
  const rank = (c) => {
    const i = TIERS.indexOf(c.tier);
    return i < 0 ? TIERS.length : i;
  };
  const pairable = candidates.filter((c) => (c.harness ?? 'slicc-kernel') === 'slicc-kernel');
  const other = candidates
    .filter((c) => (c.harness ?? 'slicc-kernel') !== 'slicc-kernel')
    .map((c) => ({
      package: c.package,
      live: false,
      why: `harness ${c.harness}`,
    }))
    .sort((a, b) => (a.package < b.package ? -1 : a.package > b.package ? 1 : 0));
  const ordered = [...pairable].sort((a, b) => rank(a) - rank(b) || (a.package < b.package ? -1 : a.package > b.package ? 1 : 0));
  return {
    max,
    live: ordered.slice(0, max).map((c) => ({ package: c.package, tier: c.tier })),
    capped: ordered.slice(max).map((c) => ({
      package: c.package,
      tier: c.tier,
      live: false,
      why: 'cap',
    })),
    other,
  };
}

/** The prompt's paragraph on this run's pairs, naming the capped packages. */
export function capNote(plan) {
  const names = (list) => list.map((c) => `\`${c.package}\``).join(', ');
  if (!plan.capped.length) {
    return plan.live.length ? `Every package with a slicc-kernel harness has a live pair (${names(plan.live)}).` : 'No package in this pull request has a live pair.';
  }
  return [
    `Live pairs are capped at ${plan.max} per run (LIVE_PAIRS_MAX), so the runner keeps memory for you: ${plan.live.length ? `${names(plan.live)} ${plan.live.length === 1 ? 'has' : 'have'} one` : 'no package has one'}.`,
    `**${names(plan.capped)} ${plan.capped.length === 1 ? 'has' : 'have'} no live pair (cap)**: review ${plan.capped.length === 1 ? 'it' : 'them'} from ladder-pr's \`cert (<package>)\` jobs and the harness (\`cert-run … run.mjs\`, one package at a time).`,
    `To compare a capped package's baseline and head interactively, \`live-pair start <package>\` opens a pair for it and adds its sides to live.json (at most ${ON_DEMAND_MAX} on-demand pairs at once; a third is refused), and \`live-pair stop <package>\` closes it again. Stop one before you start another.`,
  ].join(' ');
}

export function memoryLine(when) {
  let available = null;
  try {
    const m = readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+) kB/m);
    if (m) available = Math.round(Number(m[1]) / 1024);
  } catch {}
  const mb = (n) => `${Math.round(n / 1048576)} MiB`;
  return `live-pairs: memory ${when}: ${available !== null ? `${available} MiB available, ` : ''}${mb(freemem())} free of ${mb(totalmem())}`;
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function tarList(tgz) {
  const r = spawnSync('tar', ['-tzf', tgz], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
}

function tarJson(tgz, path) {
  const r = spawnSync('tar', ['-xzf', tgz, '-O', path], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

function changedUnder(root, base, pkg) {
  if (!base) return null;
  const r = spawnSync('git', ['-C', root, 'diff', '--name-only', `${base}...HEAD`, '--', `packages/${pkg}/`], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((f) => f.slice(`packages/${pkg}/`.length));
}

function harnessOf(root, pkg) {
  const meta = readJson(join(root, 'packages', pkg, 'cert', 'meta.json'), null);
  if (!meta) return 'slicc-kernel';
  return meta.blocked ? 'blocked' : (meta.harness ?? 'slicc-kernel');
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** pid and every descendant (Chromes run in their own process group). */
function tree(pid) {
  const r = spawnSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' });
  if (r.status !== 0) return [pid];
  const kids = new Map();
  for (const line of r.stdout.split('\n')) {
    const [p, pp] = line.trim().split(/\s+/).map(Number);
    if (!p) continue;
    if (!kids.has(pp)) kids.set(pp, []);
    kids.get(pp).push(p);
  }
  const out = [];
  const walk = (p) => {
    out.push(p);
    for (const k of kids.get(p) ?? []) walk(k);
  };
  walk(pid);
  return out;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function kill(pids) {
  const all = [...new Set(pids.flatMap((p) => tree(p)))];
  for (const p of all) {
    try {
      process.kill(p, 'SIGTERM');
    } catch {}
  }
  for (let i = 0; i < 20 && all.some(alive); i++) await sleep(250);
  for (const p of all.filter(alive)) {
    try {
      process.kill(p, 'SIGKILL');
    } catch {}
  }
}

function paths(liveDir) {
  return { live: join(liveDir, 'live.json'), config: join(liveDir, 'config.json'), lock: join(liveDir, 'live.lock') };
}

/**
 * Run fn holding <live>/live.lock, so concurrent `live-pair start`/`stop`
 * calls (the reviewer can run Bash calls in parallel) can't both pass the
 * on-demand limit, take the same ports, or drop each other's live.json entries.
 * A lock older than STALE_LOCK_MS is from a killed call and is taken over.
 */
export const STALE_LOCK_MS = 120000;
export async function withLock(lock, fn, { wait = 300000 } = {}) {
  const until = Date.now() + wait;
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx'));
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        if (Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS) unlinkSync(lock);
      } catch {}
      if (Date.now() > until) throw new Error(`${lock} is held by another live-pair call; try again`);
      await sleep(100);
    }
  }
  try {
    return await fn();
  } finally {
    try {
      unlinkSync(lock);
    } catch {}
  }
}

function nextPort(entries, first = FIRST_PORT) {
  const used = entries.map((e) => e.port).filter(Number.isInteger);
  return used.length ? Math.max(...used) + 1 : first;
}

/** Fetch the baseline and start both sides of one package's pair; returns its live.json entries. */
function launch(cfg, pkg, port, { onDemand = false } = {}) {
  const meta = readJson(join(cfg.root, 'packages', pkg, 'cert', 'meta.json'), {});
  const peers = [...(meta.needsRepack ?? []), ...(meta.needsTarballScripts ?? [])].length > 0;
  const headTgz = join(cfg.artifacts, `host-${pkg}-pr${cfg.pr}`, 'package.tgz');
  const name = tarJson(headTgz, 'package/package.json')?.name;
  let baseTgz = null;
  const tag = spawnSync('node', [join(cfg.tools, 'scripts', 'npm-tag.mjs'), pkg, '--root', cfg.root], { encoding: 'utf8' });
  if (tag.status !== 0 || !tag.stdout.trim()) console.log(`::warning::${pkg}: no valid npm-tag; no baseline`);
  else if (name) {
    const pack = spawnSync('npm', ['pack', `${name}@${tag.stdout.trim()}`, '--json'], { cwd: cfg.live, encoding: 'utf8' });
    let file = null;
    try {
      if (pack.status === 0) file = JSON.parse(pack.stdout || '[]')[0]?.filename ?? null;
    } catch {}
    if (file) baseTgz = join(cfg.live, file);
    else console.log(`${pkg}: no ${name}@${tag.stdout.trim()} on npm; no baseline`);
  }
  const entries = [];
  for (const [side, tgz] of [
    ['base', baseTgz],
    ['head', existsSync(headTgz) ? headTgz : null],
  ]) {
    const p = port++;
    if (!tgz) continue;
    const log = openSync(join(cfg.live, `${pkg}-${side}.log`), 'w');
    const child = spawn(
      'node',
      [
        join(cfg.tools, 'scripts', 'browser-cert', 'run.mjs'),
        '--package',
        pkg,
        '--cert',
        join(cfg.root, 'packages', pkg, 'cert'),
        '--tarball',
        tgz,
        '--users',
        'enforce',
        '--live',
        String(p),
      ],
      {
        cwd: cfg.root,
        detached: true,
        stdio: ['ignore', log, log],
        env: {
          ...process.env,
          HOMESCOOP_CERT_NODE_MODULES: join(cfg.harness, pkg, 'node_modules'),
        },
      },
    );
    child.unref();
    entries.push({
      package: pkg,
      side,
      tarball: tgz,
      url: `http://127.0.0.1:${p}/`,
      port: p,
      pid: child.pid,
      peers_from_pr: peers,
      on_demand: onDemand,
    });
  }
  return entries;
}

async function waitUp(entries, liveDir, { tries = 480 } = {}) {
  await Promise.all(
    entries.map(async (e) => {
      for (let i = 0; i < tries; i++) {
        try {
          const res = await fetch(e.url);
          if (res.ok) {
            console.log(`${e.url} ${e.package} ${e.side}: ${(await res.text()).trim()}`);
            return;
          }
        } catch {}
        if (!alive(e.pid)) break;
        await sleep(500);
      }
      console.log(`::warning::${e.url} (${e.package} ${e.side}) didn't come up; see its log, ${join(liveDir, `${e.package}-${e.side}.log`)}`);
    }),
  );
}

async function up(opts) {
  const cfg = {
    root: resolve(opts.root),
    tools: resolve(opts.tools),
    artifacts: resolve(opts.artifacts),
    harness: resolve(opts.harness),
    live: resolve(opts.live),
    pr: opts.pr,
    port: opts.port ? Number(opts.port) : FIRST_PORT,
  };
  mkdirSync(cfg.live, { recursive: true });
  writeFileSync(paths(cfg.live).config, `${JSON.stringify(cfg, null, 2)}\n`);
  const packages = JSON.parse(opts.packages || '[]');
  const candidates = packages.map((pkg) => {
    const files = tarList(join(cfg.artifacts, `host-${pkg}-pr${cfg.pr}`, 'package.tgz'));
    return {
      package: pkg,
      harness: harnessOf(cfg.root, pkg),
      tier: tierOf({ files, changed: changedUnder(cfg.root, opts.base, pkg) }),
    };
  });
  const plan = planLivePairs(candidates, {
    max: liveMax(opts.max ?? process.env.LIVE_PAIRS_MAX),
  });
  console.log(`live-pairs: ${plan.live.length} up front (max ${plan.max}): ${plan.live.map((c) => `${c.package} (${c.tier})`).join(', ') || 'none'}`);
  console.log(`live-pairs: capped: ${plan.capped.map((c) => `${c.package} (${c.tier})`).join(', ') || 'none'}`);
  for (const o of plan.other) console.log(`${o.package}: no live pair, its cert harness is ${o.why.replace(/^harness /, '')}`);
  writeFileSync(join(cfg.live, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
  if (opts.note) writeFileSync(opts.note, `${capNote(plan)}\n`);
  console.log(memoryLine('before the pairs'));
  let entries = [];
  let port = cfg.port;
  for (const c of plan.live) {
    entries.push(...launch(cfg, c.package, port));
    port += 2;
  }
  entries = [
    ...entries,
    ...plan.capped.map(({ package: p, why }) => ({
      package: p,
      live: false,
      why,
    })),
    ...plan.other,
  ];
  writeFileSync(paths(cfg.live).live, `${JSON.stringify(entries, null, 2)}\n`);
  await waitUp(
    entries.filter((e) => e.url),
    cfg.live,
  );
  console.log(memoryLine('after the pairs'));
  console.log(readFileSync(paths(cfg.live).live, 'utf8'));
}

async function start(pkg, opts) {
  const p = paths(resolve(opts.live));
  const cfg = readJson(p.config, null);
  if (!cfg) throw new Error(`no ${p.config}: the live pairs step didn't run`);
  const added = await withLock(p.lock, () => claim(cfg, p, pkg));
  await waitUp(added, cfg.live);
  console.log(memoryLine(`after ${pkg}'s pair`));
  console.log(JSON.stringify(added, null, 2));
}

/** The check, launch and live.json write of an on-demand start, under the lock. */
function claim(cfg, p, pkg) {
  const entries = readJson(p.live, []);
  const known = entries.filter((e) => e.package === pkg);
  if (!known.length) throw new Error(`${pkg} isn't a package of this pull request (see ${p.live})`);
  const other = known.find((e) => e.live === false && e.why?.startsWith('harness '));
  if (other) throw new Error(`${pkg} has no live pair: its cert ${other.why}`);
  if (known.some((e) => e.url && alive(e.pid)))
    throw new Error(
      `${pkg} already has a live pair: ${known
        .filter((e) => e.url)
        .map((e) => e.url)
        .join(' ')}`,
    );
  const running = [...new Set(entries.filter((e) => e.on_demand && e.url && alive(e.pid)).map((e) => e.package))];
  if (running.length >= ON_DEMAND_MAX) {
    throw new Error(`refused: ${running.length} on-demand pairs are open (${running.join(', ')}), the most at once is ${ON_DEMAND_MAX}; live-pair stop one first`);
  }
  console.log(memoryLine(`before ${pkg}'s pair`));
  const added = launch(cfg, pkg, nextPort(entries, cfg.port), {
    onDemand: true,
  });
  const next = [...entries.filter((e) => e.package !== pkg), ...added];
  writeFileSync(p.live, `${JSON.stringify(next, null, 2)}\n`);
  return added;
}

async function stop(pkg, opts) {
  const p = paths(resolve(opts.live));
  await withLock(p.lock, async () => {
    const entries = readJson(p.live, []);
    const pair = entries.filter((e) => e.url && (pkg === null || e.package === pkg));
    if (pkg !== null && !pair.length) throw new Error(`${pkg} has no live pair`);
    await kill(pair.map((e) => e.pid).filter(Number.isInteger));
    const gone = new Set(pair.map((e) => e.package));
    const next = [
      ...entries.filter((e) => !(e.url && gone.has(e.package))),
      ...[...gone].map((name) => ({
        package: name,
        live: false,
        why: 'stopped',
      })),
    ];
    writeFileSync(p.live, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`live-pairs: stopped ${[...gone].join(', ') || 'nothing'}`);
    console.log(memoryLine('after stopping'));
  });
}

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      packages: { type: 'string' },
      root: { type: 'string', default: '.' },
      tools: { type: 'string', default: '.' },
      artifacts: { type: 'string' },
      harness: { type: 'string' },
      live: { type: 'string', default: process.env.LIVE_PAIRS_DIR },
      pr: { type: 'string' },
      base: { type: 'string' },
      max: { type: 'string' },
      note: { type: 'string' },
      port: { type: 'string' },
    },
  });
  const [cmd, pkg] = positionals;
  if (!values.live) throw new Error('--live <dir> (or LIVE_PAIRS_DIR) is required');
  if (cmd === 'up') return up(values);
  if (cmd === 'start' && pkg) return start(pkg, values);
  if (cmd === 'stop' && pkg) return stop(pkg, values);
  if (cmd === 'stop-all') return stop(null, values);
  throw new Error('usage: live-pairs.mjs up|start <package>|stop <package>|stop-all --live <dir> …');
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`live-pairs: ${err.message}`);
    process.exit(1);
  });
}
