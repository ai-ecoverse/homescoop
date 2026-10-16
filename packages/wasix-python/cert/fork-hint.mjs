const HINT = "isn't available in this python. Re-run with PYTHON_FORK=true (needs slicc-kernel >= 1.110.0) to use the fork-capable build.";
const SCRIPT = String.raw`
import json, multiprocessing as mp, os, sys
def attempt(f):
    try:
        return ["ok", f()]
    except Exception as e:
        return [type(e).__name__, str(e)]
out = {
    "hasattr": [hasattr(os, "fork"), hasattr(os, "forkpty")],
    "fork": attempt(lambda: os.fork()),
    "forkpty": attempt(lambda: os.forkpty()),
    "other": attempt(lambda: os.no_such_thing),
    "ctx_fork": attempt(lambda: mp.get_context("fork")),
    "ctx_forkserver": attempt(lambda: mp.get_context("forkserver")),
    "set_fork": attempt(lambda: mp.set_start_method("fork")),
    "methods": mp.get_all_start_methods(),
    "start": mp.get_start_method(),
    "env": os.environ.get("PYTHON_FORK"),
    "executable": sys.executable,
}
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/fork_hint.py', SCRIPT);
  for (const env of [{}, { PYTHON_FORK: '1' }, { PYTHON_FORK: 'false' }]) {
    const r = await run(['python3', '/tmp/fork_hint.py'], { cwd: '/tmp', env });
    assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    const o = JSON.stringify(out);
    assert.deepEqual(out.hasattr, [false, false], `hasattr(os, "fork") stays False: ${o}`);
    assert.deepEqual(out.fork, ['AttributeError', `os.fork() ${HINT}`], o);
    assert.deepEqual(out.forkpty, ['AttributeError', `os.forkpty() ${HINT}`], o);
    assert.deepEqual(out.other, ['AttributeError', "module 'os' has no attribute 'no_such_thing'"], o);
    assert.deepEqual(out.ctx_fork, ['ValueError', `multiprocessing's 'fork' start method ${HINT}`], o);
    assert.deepEqual(out.ctx_forkserver, ['ValueError', `multiprocessing's 'forkserver' start method ${HINT}`], o);
    assert.deepEqual(out.set_fork, ['ValueError', `multiprocessing's 'fork' start method ${HINT}`], o);
    assert.deepEqual(out.methods, ['spawn'], o);
    assert.equal(out.start, 'spawn', o);
  }
  console.log(`default binary (no PYTHON_FORK, or PYTHON_FORK=1 / false, which aren't "true"): hasattr(os, "fork") False; os.fork(), os.forkpty() raise AttributeError and get_context/set_start_method("fork"/"forkserver") ValueError, each "… ${HINT}"; start methods ['spawn']`);
}
