const TOOLS = '/node_modules/@ai-ecoverse/wasm-go/goroot/pkg/tool/wasip1_wasm';

export async function importcfg(ctx, std, extra = []) {
  const found = await ctx.run(['find', std, '-name', '*.a'], { cwd: '/' });
  ctx.assert.equal(found.status, 0, found.stderr);
  const lines = found.stdout.trim().split('\n').filter(Boolean).map((f) => `packagefile ${f.slice(std.length + 1, -2)}=${f}`);
  ctx.assert.ok(lines.length > 200, `std has ${lines.length} archives`);
  return [...extra, ...lines].join('\n') + '\n';
}

export async function compileLink(ctx, { std, env = {}, out }) {
  const { assert } = ctx;
  const cwd = '/home/cone/g';
  const run = (argv) => ctx.run(argv, { cwd, env, user: 'cone' });
  await ctx.write(`${cwd}/hello.go`, 'package main\n\nimport (\n\t"fmt"\n\t"os"\n)\n\nfunc main() { fmt.Println("hello from go", 6*7, len(os.Args)) }\n');
  await ctx.write(`${cwd}/importcfg`, await importcfg(ctx, std));
  const c = await run([`${TOOLS}/compile`, '-o', 'hello.o', '-p', 'main', '-importcfg', 'importcfg', '-pack', 'hello.go']);
  assert.equal(c.status, 0, `compile: ${c.stdout}${c.stderr}`);
  await ctx.write(`${cwd}/importcfg.link`, await importcfg(ctx, std, ['packagefile main=hello.o']));
  const l = await run([`${TOOLS}/link`, '-o', out, '-importcfg', 'importcfg.link', '-buildmode=exe', 'hello.o']);
  assert.equal(l.status, 0, `link: ${l.stdout}${l.stderr}`);
  return { run, cwd };
}

export default async function hello(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: 'cone' });
  const goVersion = JSON.parse(await ctx.read('/node_modules/@ai-ecoverse/wasm-go/package.json')).slicc.go.version;
  const rootVersion = (await ctx.read('/node_modules/@ai-ecoverse/wasm-go/goroot/VERSION')).split('\n')[0];
  assert.equal(goVersion, rootVersion, 'package.json slicc.go.version is goroot/VERSION (homescoop#746)');
  const stdVersion = JSON.parse(await ctx.read('/node_modules/@ai-ecoverse/wasm-go-std-wasip1/package.json')).slicc.go.version;
  assert.equal(stdVersion, rootVersion, 'the std package installed with it has the same slicc.go.version');
  for (const tool of ['compile', 'link', 'asm']) {
    const v = await ctx.run([`${TOOLS}/${tool}`, '-V'], { cwd: '/home', user: 'cone' });
    assert.equal(v.status, 0, `${tool} -V: ${v.stderr}`);
    assert.equal(v.stdout, `${tool} version ${goVersion}\n`);
  }
  const { run } = await compileLink(ctx, { std: '/node_modules/@ai-ecoverse/wasm-go-std-wasip1/goroot/pkg/wasip1_wasm', out: 'hello.wasm' });
  const r = await run(['/home/cone/g/hello.wasm', 'a', 'b']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'hello from go 42 3\n', 'a wasip1 program compiled and linked in the kernel runs there');
}
