/**
 * findutils checklist: find (names, types, -exec ; and +) and xargs
 * (batching, -n, -I, -P, exit 123). find -exec and xargs run their commands
 * through fork + execvp (slicc fork profile), so these cases exercise
 * slicc_spawn as well as findutils itself.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const sh = (script) => run(['bash', '-c', script], { cwd: '/home' });
  const ok = (r, what) => assert.equal(r.status, 0, `${what}: rc=${r.status} stderr=${r.stderr}`);

  const setup = await sh(
    'rm -rf /home/fu && mkdir -p /home/fu/a/b /home/fu/c && ' +
      'echo one > /home/fu/a/1.txt && echo two > /home/fu/a/b/2.txt && ' +
      'echo three > /home/fu/c/3.log && echo four > /home/fu/4.txt',
  );
  ok(setup, 'setup');

  const names = await sh("find /home/fu -name '*.txt' | sort");
  ok(names, 'find -name');
  assert.equal(names.stdout, '/home/fu/4.txt\n/home/fu/a/1.txt\n/home/fu/a/b/2.txt\n');

  const dirs = await sh('find /home/fu -mindepth 1 -type d | sort');
  ok(dirs, 'find -type d');
  assert.equal(dirs.stdout, '/home/fu/a\n/home/fu/a/b\n/home/fu/c\n');

  // -exec … ; runs one child per file (fork + exec of coreutils cat).
  const each = await sh("find /home/fu -name '*.txt' -exec cat {} ';' | sort");
  ok(each, 'find -exec ;');
  assert.equal(each.stdout, 'four\none\ntwo\n');

  // -exec … + batches files into one command line.
  const batch = await sh("find /home/fu -name '*.txt' -exec echo BATCH {} + | wc -l");
  ok(batch, 'find -exec +');
  assert.equal(batch.stdout.trim(), '1', `-exec + should run once: ${batch.stdout}`);

  // Exit status: ; ignores the command's status, + propagates failure.
  const semi = await sh("find /home/fu -name '*.log' -exec false {} ';'");
  assert.equal(semi.status, 0, `-exec false ; rc=${semi.status}`);
  const plus = await sh("find /home/fu -name '*.log' -exec false {} +");
  assert.equal(plus.status, 1, `-exec false + rc=${plus.status}`);

  // -execdir runs from the file's directory.
  const execdir = await sh("find /home/fu -name 3.log -execdir pwd ';'");
  ok(execdir, 'find -execdir');
  assert.equal(execdir.stdout, '/home/fu/c\n');

  // xargs: default batching, -n, -I.
  const xs = await sh("printf 'a\\nb\\nc\\n' | xargs echo");
  ok(xs, 'xargs');
  assert.equal(xs.stdout, 'a b c\n');
  const n1 = await sh("printf 'a\\nb\\nc\\n' | xargs -n1 echo item | sort");
  ok(n1, 'xargs -n1');
  assert.equal(n1.stdout, 'item a\nitem b\nitem c\n');
  const repl = await sh("find /home/fu -name '*.txt' | sort | xargs -I{} basename {}");
  ok(repl, 'xargs -I');
  assert.equal(repl.stdout, '4.txt\n1.txt\n2.txt\n');

  // xargs -P: several children at once; every job runs and xargs waits for all.
  const par = await sh(
    "seq 1 8 | xargs -P4 -I{} bash -c 'sleep 0.2; echo job-{}' | sort -t- -k2 -n",
  );
  ok(par, 'xargs -P4');
  assert.equal(par.stdout, [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `job-${i}\n`).join(''));

  // A failing command makes xargs exit 123.
  const fail = await sh('echo x | xargs false');
  assert.equal(fail.status, 123, `xargs false rc=${fail.status}`);

  const ver = await run(['find', '--version'], { cwd: '/home' });
  ok(ver, 'find --version');
  assert.match(ver.stdout, /find \(GNU findutils\) 4\.11\.0/);
}
