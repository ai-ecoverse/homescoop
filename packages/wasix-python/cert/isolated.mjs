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
  const md = await run(['mkdir', '-p', '/tmp/fh/lib/python3.15', '/tmp/ev/bin', '/tmp/ev/lib/python3.15/site-packages', '/tmp/xc', '/tmp/cv/bin', '/tmp/cv/lib/python3.15/site-packages', '/tmp/pt/bin/lib/python3.15'], { cwd: '/tmp' });
  assert.equal(md.status, 0, `mkdir: ${md.stderr}`);
  await write('/tmp/fh/lib/python3.15/encodings.py', 'import sys\nsys.stderr.write("FAKEHOME-LOADED\\n")\nraise SystemExit(3)\n');
  await write('/tmp/ev/bin/python3', '#!/bin/sh\necho EVIL-EXE\n');
  await write('/tmp/ev/pyvenv.cfg', 'home = /usr/bin\ninclude-system-site-packages = false\n');
  await write('/tmp/ev/lib/python3.15/site-packages/evil.pth', 'import sys; sys.stderr.write("EVIL-PTH\\n")\n');
  await write('/tmp/iso.py', '#!/usr/bin/python3 -I\nimport sys\nprint(sys.prefix, sys.executable)\n');
  await write('/tmp/cv/pyvenv.cfg', 'home = /usr/bin\ninclude-system-site-packages = false\n');
  await write('/tmp/cv/bin/pyvenv.cfg', 'home = /usr/bin\ninclude-system-site-packages = false\n');
  await write('/tmp/cv/lib/python3.15/site-packages/cwd.pth', 'import sys; sys.stderr.write("EVIL-PTH\\n")\n');
  await write('/tmp/pt/bin/python3', '#!/bin/sh\necho EVIL-EXE\n');
  await write('/tmp/pt/bin/python3._pth', 'lib/python3.15\nimport site\n');
  await write('/tmp/pt/bin/lib/python3.15/encodings.py', 'import sys\nsys.stderr.write("EVIL-PTH\\n")\nraise SystemExit(3)\n');
  const cm = await run(['chmod', '755', '/tmp/ev/bin/python3', '/tmp/pt/bin/python3', '/tmp/iso.py'], { cwd: '/tmp' });
  assert.equal(cm.status, 0, `chmod: ${cm.stderr}`);
  const problems = [];
  const homes = [];
  for (const name of ['PYTHONHOME', 'SLICC_PYTHONHOME']) {
    for (const flag of ['-I', '-E']) {
      const h = await run(['python3', flag, '-c', 'import sys; print(sys.prefix)'], { cwd: '/tmp', env: { [name]: '/tmp/fh' } });
      const label = `${name}=/tmp/fh python3 ${flag}`;
      homes.push(label);
      if (`${h.stdout}${h.stderr}`.includes('FAKEHOME-LOADED')) problems.push(`${label} ran /tmp/fh's encodings.py (rc ${h.status})`);
      else if (h.status !== 0) problems.push(`${label}: rc ${h.status} ${h.stderr.slice(-300)}`);
      else if (h.stdout.trim() !== prefix) problems.push(`${label}: sys.prefix ${h.stdout.trim()}, want the package ${prefix}`);
    }
  }
  const q = 'import sys; print(sys.prefix, sys.executable)';
  const viaPath = [
    ['python3 -I', ['python3', '-I', '-c', q]],
    ['python3 -E', ['python3', '-E', '-c', q]],
    ['#!/usr/bin/python3 -I', ['/tmp/iso.py']],
  ];
  const vectors = [];
  for (const [name, argv] of viaPath) vectors.push([`PATH=/tmp/ev/bin:/usr/bin:/bin ${name}`, argv, '/tmp', { PATH: '/tmp/ev/bin:/usr/bin:/bin' }]);
  for (const cwd of ['/tmp/cv', '/tmp/cv/bin']) {
    for (const flag of ['-I', '-E']) vectors.push([`cwd ${cwd} (a pyvenv.cfg), PATH=/tmp/nowhere /usr/bin/python3 ${flag}`, ['/usr/bin/python3', flag, '-c', q], cwd, { PATH: '/tmp/nowhere' }]);
    vectors.push([`cwd ${cwd} (a pyvenv.cfg) #!/usr/bin/python3 -I`, ['/tmp/iso.py'], cwd, {}]);
  }
  for (const name of ['PYTHONEXECUTABLE', '__PYVENV_LAUNCHER__']) {
    for (const [exe, what] of [['/tmp/ev/bin/python3', 'a pyvenv.cfg'], ['/tmp/pt/bin/python3', 'a python3._pth']]) {
      for (const flag of ['-I', '-E']) vectors.push([`${name}=${exe} (${what}) python3 ${flag}`, ['python3', flag, '-c', q], '/tmp', { [name]: exe }]);
      vectors.push([`${name}=${exe} (${what}) #!/usr/bin/python3 -I`, ['/tmp/iso.py'], '/tmp', { [name]: exe }]);
    }
  }
  for (const [label, argv, cwd, env] of vectors) {
    const v = await run(argv, { cwd, env });
    if (`${v.stdout}${v.stderr}`.includes('EVIL-PTH')) problems.push(`${label} ran the caller's .pth or ._pth home (rc ${v.status}, ${v.stdout.trim()})`);
    else if (v.status !== 0) problems.push(`${label}: rc ${v.status} ${v.stderr.slice(-300)}`);
    else if (v.stdout.trim() !== `${prefix} /usr/bin/python3`) problems.push(`${label}: sys.prefix, sys.executable ${v.stdout.trim()}, want ${prefix} /usr/bin/python3`);
  }
  const ls = 'import os, sys; print(sorted(os.path.relpath(os.path.join(d, f), sys.argv[1]) for d, ds, fs in os.walk(sys.argv[1]) for f in ds + fs))';
  const iso = await run(['python3', '-I', '-c', 'import sys; print(len([p for p in sys.path if "/py-" in p]))'], { cwd: '/tmp', env: { XDG_CACHE_HOME: '/tmp/xc', HOME: '/tmp/xc' } });
  assert.equal(iso.status, 0, `python3 -I with a caller's XDG_CACHE_HOME: rc=${iso.status} ${iso.stderr}`);
  assert.ok(Number(iso.stdout.trim()) >= 1, `python3 -I still discovers the py-* packages: ${iso.stdout}`);
  const left = await run(['python3', '-c', ls, '/tmp/xc'], { cwd: '/tmp' });
  if (left.stdout.trim() !== '[]') problems.push(`python3 -I keeps its discovery cache under a caller's XDG_CACHE_HOME/HOME: ${left.stdout.trim()}`);
  const marker = await run(['python3', '-c', 'import sys; print(sys.orig_argv[1:3])'], { cwd: '/tmp' });
  if (marker.stdout.trim() !== `['-X', 'slicc_home=${prefix}']`) problems.push(`the command's argv prefix is ${marker.stdout.trim()}, want ['-X', 'slicc_home=${prefix}']`);
  assert.deepEqual(problems, [], `isolated: ${problems.join('; ')}`);
  const plain = await run(['python3', '-c', 'print(1)'], { cwd: '/tmp', env: { PYTHONHOME: '/tmp/fh' } });
  assert.notEqual(plain.status, 0, `PYTHONHOME=/tmp/fh python3 without -I/-E uses that home: rc=${plain.status} ${plain.stderr}`);
  assert.ok(plain.stderr.includes('FAKEHOME-LOADED'), `PYTHONHOME=/tmp/fh python3: ${plain.stderr}`);
  const env = await run(['python3', '-c', 'print(1)'], { cwd: '/tmp', env: { XDG_CACHE_HOME: '/tmp/xc' } });
  assert.equal(env.status, 0, `python3 with XDG_CACHE_HOME=/tmp/xc: rc=${env.status} ${env.stderr}`);
  const used = await run(['python3', '-c', ls, '/tmp/xc'], { cwd: '/tmp' });
  assert.ok(used.stdout.includes('slicc-site/'), `plain python3 keeps its discovery cache in XDG_CACHE_HOME: ${used.stdout}${used.stderr}`);
  console.log(`isolated: python3 -I and -E start with sys.prefix ${prefix} (encodings found), -E still ignores PYTHONPATH, python3 -Im runs a module; ${homes.join(', ')} keep ${prefix} and never run /tmp/fh's encodings.py, and plain python3 uses PYTHONHOME=/tmp/fh (rc ${plain.status}); ${vectors.length} caller-chosen PATH, cwd, PYTHONEXECUTABLE and __PYVENV_LAUNCHER__ cases (${vectors.map(([l]) => l).join('; ')}) keep ${prefix} and /usr/bin/python3 and never run the caller's .pth or ._pth home; python3 -I keeps no discovery cache under a caller's XDG_CACHE_HOME/HOME, plain python3 does; the command's argv starts with -X slicc_home=${prefix}`);
}
