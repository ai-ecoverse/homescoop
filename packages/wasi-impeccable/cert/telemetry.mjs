/**
 * wasi-impeccable 0.1.15's telemetry (homescoop#482), as a user other than
 * root under users enforce: the `telemetry` verb and where it records the
 * opt-out, DO_NOT_TRACK / IMPECCABLE_NO_TELEMETRY (`0` and `false` don't
 * opt out), and what concept-seed sends. ctx.serve is the roll API
 * (IMPECCABLE_API_URL, plain http through the kernel's proxy). Its answers
 * check the requests: a roll whose key (`--from`) starts with `off-` must carry
 * `X-Impeccable-Telemetry: off` and one whose key starts with `on-` must
 * not, or the roll fails and concept-seed reports `source: degraded`; a
 * choice ping for an opted-out key fails every later roll. Also the seed
 * ledger (`--from` with the seed reference) and git_tracked with a `.git`
 * but no git command.
 */
import { readFileSync } from 'node:fs';

const ROLL = readFileSync(new URL('../test/fixtures/roll-surface.json', import.meta.url), 'utf8');

// Self-contained: ctx.serve evaluates the source in the page.
const responder = {
  toString: () => `(req) => {
    const ROLL = ${JSON.stringify(ROLL)};
    const state = (globalThis.__impeccable ||= { violations: [], chosen: [] });
    const u = new URL(req.url);
    const header = (name) => (req.headers.find(([k]) => k.toLowerCase() === name) ?? [])[1];
    const json = (status, body) => ({ status, headers: [['content-type', 'application/json']], body });
    if (u.host !== 'api.impeccable.test') return { status: 404, body: 'not mocked' };
    if (u.pathname === '/api/roll') {
      const key = u.searchParams.get('key') ?? '';
      const off = header('x-impeccable-telemetry');
      if (key.startsWith('off-') && off !== 'off') state.violations.push('roll ' + key + ' without X-Impeccable-Telemetry: off');
      if (key.startsWith('on-') && off !== undefined) state.violations.push('roll ' + key + ' with X-Impeccable-Telemetry: ' + off);
      if (state.violations.length) return json(409, JSON.stringify({ violations: state.violations }));
      return json(200, ROLL);
    }
    if (u.pathname === '/api/chosen' && req.method === 'POST') {
      const body = JSON.parse(new TextDecoder().decode(req.body));
      state.chosen.push(body.key);
      if (String(body.key).startsWith('off-')) state.violations.push('choice ping for ' + body.key);
      return json(200, '{}');
    }
    return { status: 404, body: 'not mocked' };
  }`,
};

export default async function (ctx) {
  const { run, write, read, assert, addUser, serve } = ctx;
  await serve(responder);
  await addUser({ name: 'alice' });
  const home = '/home/alice';
  const base = { HOME: home, IMPECCABLE_API_URL: 'http://api.impeccable.test/api', IMPECCABLE_NO_STALENESS_CHECK: '1' };
  const imp = (args, env = {}) => run(['impeccable', ...args], { cwd: home, user: 'alice', env: { ...base, ...env } });
  const out = (r) => `rc=${r.status}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`;

  // status: the environment opt-outs; 0 and false are not one.
  const status = async (env) => {
    const r = await imp(['telemetry', 'status'], env);
    assert.equal(r.status, 0, out(r));
    return r.stdout;
  };
  assert.match(await status({}), /^telemetry: on\. /);
  assert.match(await status({ DO_NOT_TRACK: '1' }), /^telemetry: off \(DO_NOT_TRACK is set\)\./);
  assert.match(await status({ DO_NOT_TRACK: '0' }), /^telemetry: on\. /);
  assert.match(await status({ IMPECCABLE_NO_TELEMETRY: 'false' }), /^telemetry: on\. /);
  assert.match(await status({ IMPECCABLE_NO_TELEMETRY: 'TRUE' }), /^telemetry: off \(IMPECCABLE_NO_TELEMETRY is set\)\./);

  // A project in alice's home, with a .git and no git command on PATH.
  await write(`${home}/PRODUCT.md`, '# Product\n\nA quiet note-taking app for field researchers.\n\n## Users\n\nEcologists logging observations offline.\n');
  await write(`${home}/.git/HEAD`, 'ref: refs/heads/main\n');
  const seed = async (key, env = {}) => {
    const r = await imp(['concept-seed', '--scope', 'surface', '--from', key], env);
    assert.equal(r.status, 0, out(r));
    assert.doesNotMatch(r.stdout + r.stderr, /panicked|wasm trap|unreachable/, out(r));
    assert.equal(r.stderr, '', `concept-seed ${key}: stderr (no git on PATH must not show): ${out(r)}`);
    assert.match(r.stdout, new RegExp(`SURFACE CONCEPT SEED \\(key: ${key}; .*source: api`), out(r));
    return r.stdout;
  };
  const ping = async (key, env = {}) => {
    const r = await imp(['concept-seed', '--kind', 'assigned', '--from', key, '--scope', 'surface'], env);
    assert.equal(r.status, 0, out(r));
    return r.stdout.trim();
  };

  // Telemetry on: the roll carries no opt-out header and the choice is sent.
  const first = await seed('on-1');
  assert.equal(await ping('on-1'), 'choice recorded');
  // The seed ledger: the roll printed a reference that --from resolves here.
  const reference = /SEED REFERENCE: (\S+?)\./.exec(first)?.[1];
  assert.ok(reference, `no SEED REFERENCE in ${first}`);
  const again = await imp(['concept-seed', '--scope', 'surface', '--from', reference]);
  assert.equal(again.status, 0, out(again));
  assert.match(again.stdout, /SURFACE CONCEPT SEED \(key: on-1; /, `--from ${reference} must resolve to on-1: ${out(again)}`);

  // Opted out by the environment: the roll says so, no choice is sent.
  await seed('off-1', { DO_NOT_TRACK: '1' });
  assert.equal(await ping('off-1', { DO_NOT_TRACK: '1' }), 'choice ping skipped');
  await seed('off-2', { IMPECCABLE_NO_TELEMETRY: '1' });
  assert.equal(await ping('off-2', { IMPECCABLE_NO_TELEMETRY: '1' }), 'choice ping skipped');
  // DO_NOT_TRACK=0 is not an opt-out.
  await seed('on-2', { DO_NOT_TRACK: '0' });

  // `telemetry off` records the opt-out in alice's user config, and it sticks.
  const offCmd = await imp(['telemetry', 'off']);
  assert.equal(offCmd.status, 0, out(offCmd));
  const config = JSON.parse(await read(`${home}/.impeccable/config.json`));
  assert.equal(config.telemetry, false, JSON.stringify(config));
  assert.match(await status({}), new RegExp(`^telemetry: off \\("telemetry": false in ${home}/\\.impeccable/config\\.json\\)`));
  await seed('off-3');
  assert.equal(await ping('off-3'), 'choice ping skipped');
  // An opt-out can't be undone from the environment.
  assert.match(await status({ DO_NOT_TRACK: '0' }), /^telemetry: off /);

  // `telemetry on` removes it again.
  const onCmd = await imp(['telemetry', 'on']);
  assert.equal(onCmd.status, 0, out(onCmd));
  assert.equal(JSON.parse(await read(`${home}/.impeccable/config.json`)).telemetry, undefined);
  assert.match(await status({}), /^telemetry: on\. /);

  // No opted-out request reached the API: a violation fails every later roll.
  await seed('on-3');
  assert.equal(await ping('on-3'), 'choice recorded');
}
