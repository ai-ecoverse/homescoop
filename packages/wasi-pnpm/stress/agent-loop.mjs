/**
 * homescoop#1127 stress loop (not a cert; .github/workflows/pnpm-agent-loop.yml).
 * Seven's agent install, as bios runs it: stress/agent/ is slicc-bios
 * 4f83a49f's src/packages/agent (package.json, pnpm-lock.yaml with 66
 * resolutions, pnpm-workspace.yaml), installed with `pnpm install
 * --frozen-lockfile --trust-lockfile` against the real registry (fetched by
 * the page) under SLICC_WASM_BACKTRACE=1, AGENT_LOOP_ROUNDS times. Every
 * fourth round starts from a cold store, the rest only drop node_modules.
 * A round that traps or fails is written whole (stdout, stderr: the trap
 * and its named frames) to $AGENT_LOOP_OUT/round-<n>.txt; every round is
 * a line of $AGENT_LOOP_OUT/rounds.jsonl. The spec fails if any round did.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const here = new URL('./agent/', import.meta.url);
const FILES = Object.fromEntries(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].map((f) => [f, readFileSync(new URL(f, here), 'utf8')]));
const ROUNDS = Number(process.env.AGENT_LOOP_ROUNDS || 20);
const OUT = process.env.AGENT_LOOP_OUT || join(process.cwd(), '.homescoop-out', 'agent-loop');
const TRAP = /wasm trap|RuntimeError|unreachable|panicked|memory access out of bounds/;

const registry = {
  toString: () => `async (req) => {
    const u = new URL(req.url);
    if (u.host !== 'registry.npmjs.org' || req.method !== 'GET') return { status: 502, body: 'only registry.npmjs.org GET' };
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(req.url, { cache: 'force-cache' });
        const body = new Uint8Array(await r.arrayBuffer());
        return { status: r.status, headers: [['content-type', r.headers.get('content-type') || 'application/octet-stream']], body };
      } catch (e) {
        if (attempt >= 4) return { status: 502, body: String(e) };
        await new Promise((ok) => setTimeout(ok, 500 * (attempt + 1)));
      }
    }
  }`,
};

export default async function (ctx) {
  const { run, write, assert, addUser, serve } = ctx;
  mkdirSync(OUT, { recursive: true });
  await serve(registry);
  await addUser({ name: 'bob' });
  for (const [f, t] of Object.entries(FILES)) await write(`/home/bob/agent/${f}`, t);
  await run(['chown', '-R', 'bob', '/home/bob/agent'], { cwd: '/' });
  const bad = [];
  for (let round = 1; round <= ROUNDS; round++) {
    const cold = round % 4 === 1;
    const pre = cold ? 'rm -rf node_modules ~/.local/share/pnpm ~/.cache/pnpm; ' : 'rm -rf node_modules; ';
    const t0 = Date.now();
    const r = await run(['bash', '-c', `${pre}pnpm install --frozen-lockfile --trust-lockfile`], {
      cwd: '/home/bob/agent', user: 'bob', env: { SLICC_WASM_BACKTRACE: '1' },
    });
    const all = `${r.stdout}\n${r.stderr}`;
    const trapped = TRAP.test(all);
    const rec = { round, cold, status: r.status, seconds: (Date.now() - t0) / 1000, trapped };
    appendFileSync(join(OUT, 'rounds.jsonl'), `${JSON.stringify(rec)}\n`);
    console.log(`round ${round} ${cold ? 'cold' : 'warm'}: rc=${r.status} ${rec.seconds.toFixed(1)}s${trapped ? ' TRAP' : ''}`);
    if (trapped || r.status) {
      bad.push(round);
      writeFileSync(join(OUT, `round-${round}.txt`), `round ${round} (${cold ? 'cold' : 'warm'} store) rc=${r.status}\n--- stderr\n${r.stderr}\n--- stdout\n${r.stdout}\n`);
    }
  }
  assert.deepEqual(bad, [], `rounds that trapped or failed (logs in ${OUT}): ${bad.join(',')}`);
}
