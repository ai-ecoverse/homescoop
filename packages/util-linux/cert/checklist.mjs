/**
 * util-linux checklist (homescoop#90): rev, column, getopt are the
 * must-haves; hexdump, colrm and look ride along.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const sh = (script) => run(['bash', '-c', script], { cwd: '/home/ul' });

  const setup = await run(
    [
      'bash',
      '-c',
      [
        'rm -rf /home/ul && mkdir -p /home/ul && cd /home/ul',
        "printf 'name,age,city\\nalice,30,berlin\\nbob,4,rome\\n' > people.csv",
        "printf 'hello world\\nsecond line\\n' > lines.txt",
        "printf 'apple\\napricot\\nbanana\\ncherry\\n' > words",
      ].join(' && '),
    ],
    { cwd: '/home' },
  );
  assert.equal(setup.status, 0, `setup stderr=${setup.stderr}`);

  // rev: the issue's pipeline, a file, and multibyte characters.
  const pipe = await sh("printf 'abc\\n' | rev");
  assert.equal(pipe.status, 0, `rev pipe stderr=${pipe.stderr}`);
  assert.equal(pipe.stdout, 'cba\n');
  const file = await run(['rev', 'lines.txt'], { cwd: '/home/ul' });
  assert.equal(file.status, 0, `rev file stderr=${file.stderr}`);
  assert.equal(file.stdout, 'dlrow olleh\nenil dnoces\n');
  const utf8 = await run(['rev'], { cwd: '/home/ul', stdin: 'héllo → wörld\n' });
  assert.equal(utf8.stdout, 'dlröw → olléh\n', `rev utf8 ${JSON.stringify(utf8.stdout)}`);

  // column -t -s, lines up the CSV.
  const csv = await run(['column', '-t', '-s,', 'people.csv'], { cwd: '/home/ul' });
  assert.equal(csv.status, 0, `column -t -s, stderr=${csv.stderr}`);
  assert.equal(
    csv.stdout,
    'name   age  city\nalice  30   berlin\nbob    4    rome\n',
    `column -t -s, ${JSON.stringify(csv.stdout)}`,
  );
  const sep = await sh("column -t -s, -o ' | ' people.csv");
  assert.equal(sep.stdout, 'name  | age | city\nalice | 30  | berlin\nbob   | 4   | rome\n', `column -o ${JSON.stringify(sep.stdout)}`);
  const ws = await sh("printf 'a bb ccc\\ndddd e f\\n' | column -t");
  assert.equal(ws.stdout, 'a     bb  ccc\ndddd  e   f\n', `column -t ws ${JSON.stringify(ws.stdout)}`);

  // getopt: long options with = and as a separate word, plus short ones.
  const go = await run(
    ['getopt', '-o', 'ab:', '--long', 'alpha,beta:', '-n', 'prog', '--', '-a', '--beta=x', 'foo', '--alpha', '-b', 'y z'],
    { cwd: '/home/ul' },
  );
  assert.equal(go.status, 0, `getopt stderr=${go.stderr}`);
  assert.equal(go.stdout, " -a --beta 'x' --alpha -b 'y z' -- 'foo'\n", `getopt ${JSON.stringify(go.stdout)}`);
  // The real use: a bash option loop.
  const loop = await sh(
    [
      'parse() {',
      '  eval set -- "$(getopt -o vo: --long verbose,output: -n parse -- "$@")" || return 9',
      '  while true; do case "$1" in',
      '    -v|--verbose) echo verbose; shift ;;',
      '    -o|--output) echo "output=$2"; shift 2 ;;',
      '    --) shift; break ;;',
      '  esac; done',
      '  echo "rest=$*"',
      '}',
      'parse --output out.txt -v one --verbose two',
    ].join('\n'),
  );
  assert.equal(loop.status, 0, `getopt loop stderr=${loop.stderr}`);
  assert.equal(loop.stdout, 'output=out.txt\nverbose\nverbose\nrest=one two\n');
  const enhanced = await run(['getopt', '-T'], { cwd: '/home/ul' });
  assert.equal(enhanced.status, 4, `getopt -T rc=${enhanced.status}`);
  const unknown = await run(['getopt', '-o', 'a', '--long', 'alpha', '-n', 'prog', '--', '--gamma'], { cwd: '/home/ul' });
  assert.equal(unknown.status, 1, `getopt unknown rc=${unknown.status}`);
  // musl words it "unrecognized option: gamma" (glibc: "… option '--gamma'").
  assert.match(unknown.stderr, /prog: unrecognized option(: gamma|\s'--gamma')/);

  // hexdump -C.
  const hex = await run(['hexdump', '-C'], { cwd: '/home/ul', stdin: 'hello\n' });
  assert.equal(hex.status, 0, `hexdump stderr=${hex.stderr}`);
  assert.match(hex.stdout, /^00000000  68 65 6c 6c 6f 0a +\|hello\.\|\n00000006\n$/, `hexdump ${JSON.stringify(hex.stdout)}`);

  // colrm and look.
  const cr = await run(['colrm', '2', '3'], { cwd: '/home/ul', stdin: 'abcdef\n' });
  assert.equal(cr.stdout, 'adef\n', `colrm ${JSON.stringify(cr.stdout)}`);
  const lk = await run(['look', 'ap', 'words'], { cwd: '/home/ul' });
  assert.equal(lk.status, 0, `look stderr=${lk.stderr}`);
  assert.equal(lk.stdout, 'apple\napricot\n');

  // Errors: a missing file.
  const revMiss = await run(['rev', 'no-such-file'], { cwd: '/home/ul' });
  assert.equal(revMiss.status, 1, `rev missing rc=${revMiss.status}`);
  assert.match(revMiss.stderr, /no-such-file: No such file or directory/);
  const colMiss = await run(['column', '-t', 'no-such-file'], { cwd: '/home/ul' });
  assert.equal(colMiss.status, 1, `column missing rc=${colMiss.status}`);
  assert.match(colMiss.stderr, /no-such-file: No such file or directory/);
}
