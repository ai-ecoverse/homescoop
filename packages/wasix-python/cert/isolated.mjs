// homescoop#1144: python3 -I / -E find the stdlib. They ignore PYTHONHOME,
// which the slicc command sets to the package, and the interpreter runs as
// /usr/bin/python3 (a registered copy), so getpath found no landmark:
// "No module named 'encodings'". homescoop#1504: cpython-home-wasix.patch
// takes the home from SLICC_PYTHONHOME, which the slicc command sets, under
// -E/-I, and a caller's PYTHONHOME stays ignored there, as in stock CPython.
export default async function (ctx) {
  const { run, write, assert } = ctx;
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
  const md = await run(['mkdir', '-p', '/tmp/fh/lib/python3.15'], { cwd: '/tmp' });
  assert.equal(md.status, 0, `mkdir /tmp/fh: ${md.stderr}`);
  await write('/tmp/fh/lib/python3.15/encodings.py', 'import sys\nsys.stderr.write("FAKEHOME-LOADED\\n")\nraise SystemExit(3)\n');
  for (const flag of ['-I', '-E']) {
    const h = await run(['python3', flag, '-c', 'import sys; print(sys.prefix)'], { cwd: '/tmp', env: { PYTHONHOME: '/tmp/fh' } });
    assert.ok(!`${h.stdout}${h.stderr}`.includes('FAKEHOME-LOADED'), `PYTHONHOME=/tmp/fh python3 ${flag} ran /tmp/fh's encodings.py: rc=${h.status} ${h.stderr}`);
    assert.equal(h.status, 0, `PYTHONHOME=/tmp/fh python3 ${flag}: rc=${h.status} ${h.stderr}`);
    assert.equal(h.stdout.trim(), prefix, `PYTHONHOME=/tmp/fh python3 ${flag}: sys.prefix ${h.stdout.trim()}, want the package ${prefix}`);
  }
  const plain = await run(['python3', '-c', 'print(1)'], { cwd: '/tmp', env: { PYTHONHOME: '/tmp/fh' } });
  assert.notEqual(plain.status, 0, `PYTHONHOME=/tmp/fh python3 without -I/-E uses that home: rc=${plain.status} ${plain.stderr}`);
  assert.ok(plain.stderr.includes('FAKEHOME-LOADED'), `PYTHONHOME=/tmp/fh python3: ${plain.stderr}`);
  console.log(`isolated: python3 -I and -E start with sys.prefix ${prefix} (encodings found), -E still ignores PYTHONPATH, python3 -Im runs a module; with a caller's PYTHONHOME=/tmp/fh, -I and -E keep ${prefix} and never run /tmp/fh's encodings.py, and plain python3 uses /tmp/fh (rc ${plain.status})`);
}
