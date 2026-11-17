// Shared by the specs: write a python script, run it, parse its last stdout line as JSON.
export async function py(ctx, name, script, args = []) {
  const { run, write, assert } = ctx;
  await write(`/tmp/${name}.py`, script);
  const r = await run(['python3', `/tmp/${name}.py`, ...args], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${name}: rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}
