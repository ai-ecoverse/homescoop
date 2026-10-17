import { compileLink } from '../../wasm-go/cert/hello.mjs';

export default async function hello(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: 'cone' });
  const rootVersion = (await ctx.read('/node_modules/@ai-ecoverse/wasm-go/goroot/VERSION')).split('\n')[0];
  const goVersion = JSON.parse(await ctx.read('/node_modules/@ai-ecoverse/wasm-go-std-wasip1/package.json')).slicc.go.version;
  assert.equal(goVersion, rootVersion, 'package.json slicc.go.version is the wasm-go toolchain version it pairs with (homescoop#746)');
  const { run } = await compileLink(ctx, { std: '/node_modules/@ai-ecoverse/wasm-go-std-wasip1/goroot/pkg/wasip1_wasm', out: 'hello.wasm' });
  const r = await run(['/home/cone/g/hello.wasm', 'x']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'hello from go 42 2\n', 'fmt and os from this std link into a program that runs in the kernel');
}
