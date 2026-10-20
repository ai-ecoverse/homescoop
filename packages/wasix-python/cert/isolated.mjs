// homescoop#1144: python3 -I / -E find the stdlib. They ignore PYTHONHOME,
// which the slicc command sets to the package, and the interpreter runs as
// /usr/bin/python3 (a registered copy), so getpath found no landmark:
// "No module named 'encodings'". cpython-home-wasix.patch honours PYTHONHOME
// for the home lookup under -E/-I (they still ignore PYTHONPATH and the rest).
export default async function (ctx) {
  const { run, assert } = ctx;
  const prefix = (await run(['python3', '-c', 'import sys; print(sys.prefix)'], { cwd: '/tmp' })).stdout.trim();
  const out = {};
  for (const flag of ['-I', '-E']) {
    const r = await run(['python3', flag, '-c', 'import sys, encodings; print(sys.prefix, sys.flags.isolated, sys.flags.ignore_environment)'], { cwd: '/tmp', env: { PYTHONPATH: '/nonexistent-homescoop' } });
    assert.equal(r.status, 0, `python3 ${flag}: rc=${r.status} ${r.stderr}`);
    out[flag] = r.stdout.trim();
  }
  assert.equal(out['-I'], `${prefix} 1 1`, JSON.stringify(out));
  assert.equal(out['-E'], `${prefix} 0 1`, JSON.stringify(out));
  const pp = await run(['python3', '-E', '-c', 'import sys; print("/nonexistent-homescoop" in sys.path)'], { cwd: '/tmp', env: { PYTHONPATH: '/nonexistent-homescoop' } });
  assert.equal(pp.stdout.trim(), 'False', `-E still ignores PYTHONPATH: ${pp.stdout}${pp.stderr}`);
  const m = await run(['python3', '-Im', 'json.tool', '--help'], { cwd: '/tmp' });
  assert.equal(m.status, 0, `python3 -Im json.tool: ${m.stderr}`);
  console.log(`isolated: python3 -I and -E start with sys.prefix ${prefix} (encodings found), -E still ignores PYTHONPATH, python3 -Im runs a module`);
}
