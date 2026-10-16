import { compileLink } from '../../wasm-go/cert/hello.mjs';

export default async function hello(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: 'cone' });
  const rootVersion = (await ctx.read('/node_modules/@ai-ecoverse/wasm-go/goroot/VERSION')).split('\n')[0];
  const goVersion = JSON.parse(await ctx.read('/node_modules/@ai-ecoverse/wasm-go-std-linux-amd64/package.json')).slicc.go.version;
  assert.equal(goVersion, rootVersion, 'package.json slicc.go.version is the wasm-go toolchain version it pairs with (homescoop#746)');
  const { cwd } = await compileLink(ctx, {
    std: '/node_modules/@ai-ecoverse/wasm-go-std-linux-amd64/goroot/pkg/linux_amd64',
    env: { GOOS: 'linux', GOARCH: 'amd64' },
    out: 'hello',
  });
  const elf = await ctx.read(`${cwd}/hello`);
  assert.ok(elf && elf.startsWith('\u007fELF\u0002\u0001'), 'a 64-bit little-endian ELF');
  assert.ok(elf.length > 1_000_000, `a linked executable (${elf?.length} bytes)`);
}
