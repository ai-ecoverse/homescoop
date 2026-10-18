const MAKEFILE = [
  'NAME ?= world',
  'SRCS := $(wildcard src/*.in)',
  'OUTS := $(patsubst src/%.in,out/%.txt,$(SRCS))',
  '.PHONY: all clean',
  'all: out/all.txt',
  'out/%.txt: src/%.in | out',
  '\tcp $< $@',
  '\techo "hello $(NAME) from $(notdir $<)" >> $@',
  'out/all.txt: $(OUTS)',
  '\tcat $^ > $@',
  'out:',
  '\tmkdir -p $@',
  'clean:',
  '\trm -rf out',
  '',
].join('\n');

export default async function make(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: 'maker' });
  const cwd = '/home/maker/proj';
  const run = (argv, o = {}) => ctx.run(argv, { cwd, user: 'maker', ...o });
  await ctx.write(`${cwd}/Makefile`, MAKEFILE);
  await ctx.write(`${cwd}/src/a.in`, 'alpha\n');
  await ctx.write(`${cwd}/src/b.in`, 'beta\n');

  const v = await run(['make', '--version']);
  assert.equal(v.status, 0, v.stderr);
  assert.match(v.stdout, /^GNU Make 4\.4\.1\n/);

  const n = await run(['make', '-n']);
  assert.equal(n.status, 0, `make -n: ${n.stderr}`);
  assert.match(n.stdout, /^mkdir -p out$/m);
  assert.match(n.stdout, /^cp src\/a\.in out\/a\.txt$/m);

  const q0 = await run(['make', '-q']);
  assert.equal(q0.status, 1, 'make -q: out of date before the build');

  const b = await run(['make', 'NAME=slicc']);
  assert.equal(b.status, 0, `make: ${b.stdout}${b.stderr}`);
  const all = await run(['cat', 'out/all.txt']);
  assert.equal(all.stdout, 'alpha\nhello slicc from a.in\nbeta\nhello slicc from b.in\n', 'pattern rules, automatic variables, $(wildcard), $(patsubst), $(notdir), an order-only prerequisite and a command-line variable');

  const q1 = await run(['make', '-q', 'NAME=slicc']);
  assert.equal(q1.status, 0, 'make -q: up to date after the build');
  const again = await run(['make', 'NAME=slicc']);
  assert.match(again.stdout, /Nothing to be done for 'all'|is up to date/, again.stdout);

  await ctx.write(`${cwd}/src/c.in`, 'gamma\n');
  const inc = await run(['make', 'NAME=slicc']);
  assert.equal(inc.status, 0, inc.stderr);
  assert.match(inc.stdout, /cp src\/c\.in out\/c\.txt/);
  assert.doesNotMatch(inc.stdout, /cp src\/a\.in/, 'only the new source is rebuilt');

  const fail = await run(['make', 'nosuchtarget']);
  assert.equal(fail.status, 2, 'an unknown target exits 2');
  assert.match(fail.stderr, /No rule to make target 'nosuchtarget'/);

  const clean = await run(['make', 'clean']);
  assert.equal(clean.status, 0, clean.stderr);
  const gone = await run(['test', '-e', 'out']);
  assert.notEqual(gone.status, 0, 'make clean removed out/');
}
