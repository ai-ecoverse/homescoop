/**
 * wasi-impeccable 0.1.21-1: the agents verb (new in 0.1.21) plans, applies
 * and undoes a managed instruction on real files. Upstream names its temp
 * files (fs_writer.rs safe_write, lib.rs private_atomic_write) after
 * std::process::id(), which panics on wasm32-wasip1 ("no pids on this
 * platform"): apply trapped (rc 134) and left agents.lock behind, so every
 * later agents call timed out. 0001 uses impeccable_common::process_id().
 */
export default async function (ctx) {
  const { run, write, read, assert } = ctx;
  const H = '/home/impagents';
  const root = `${H}/claude`;
  await write(`${root.slice(1)}/.keep`, '');
  const spec = { version: 1, owner: 'impeccable-loop', harness: 'claude', root, instruction: 'managed text' };
  await write(`${H.slice(1)}/spec.json`, JSON.stringify(spec));
  const imp = (args) => run(['impeccable', 'agents', ...args], { cwd: H, env: { HOME: H } });
  const out = (label, r) => `${label} → rc=${r.status}\n--- stdout\n${r.stdout.slice(0, 600)}\n--- stderr\n${r.stderr.slice(0, 600)}`;
  const ok = async (label, args) => {
    const r = await imp(args);
    assert.equal(r.status, 0, out(label, r));
    const body = JSON.parse(r.stdout);
    assert.equal(body.ok, true, out(label, r));
    return body.result;
  };
  const ls = async (dir) => {
    const r = await run(['ls', '-A', dir], { cwd: H });
    assert.equal(r.status, 0, out(`ls ${dir}`, r));
    return r.stdout.split('\n').filter(Boolean);
  };

  await ok('plan', ['plan', '--spec', 'spec.json']);
  const applied = await ok('apply', ['apply', '--spec', 'spec.json']);
  assert.equal(applied.state, 'applied', JSON.stringify(applied));
  assert.match(await read(`${root}/CLAUDE.md`), /managed text/);
  await ok('apply again', ['apply', '--spec', 'spec.json']);
  await ok('status', ['status', '--spec', 'spec.json']);
  const listed = await ok('list', ['list']);
  assert.equal(listed.installations?.length, 1, JSON.stringify(listed));
  // No temp file or lock is left behind.
  assert.deepEqual((await ls(root)).filter((n) => n.endsWith('.tmp')), [], 'temp files in the root');
  assert.ok(!(await ls(`${H}/.impeccable/agents`)).includes('agents.lock'), 'agents.lock left behind');

  await ok('undo', ['undo', '--spec', 'spec.json']);
  const names = await ls(root);
  if (names.includes('CLAUDE.md')) assert.doesNotMatch(await read(`${root}/CLAUDE.md`), /managed text/);
  assert.ok(!(await ls(`${H}/.impeccable/agents`)).includes('agents.lock'), 'agents.lock left behind after undo');
  const after = await ok('list after undo', ['list']);
  assert.equal(after.installations?.length ?? 0, 0, JSON.stringify(after));
}
