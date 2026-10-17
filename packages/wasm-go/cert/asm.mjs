import { importcfg } from './hello.mjs';

const GOROOT = '/node_modules/@ai-ecoverse/wasm-go/goroot';
const TOOLS = `${GOROOT}/pkg/tool/wasip1_wasm`;
const STD = '/node_modules/@ai-ecoverse/wasm-go-std-wasip1/goroot/pkg/wasip1_wasm';
const ASM = '#include "textflag.h"\n\nTEXT ·f(SB),NOSPLIT,$0-8\n\tI64Const $42\n\tSet R0\n\tGet SP\n\tGet R0\n\tI64Store ret+0(FP)\n\tRET\n';
const MAIN = 'package main\n\nimport "fmt"\n\nfunc f() int64\n\nfunc main() { fmt.Println("asm says", f()) }\n';
const PACK = 'n=$(wc -c < f.o) && { cat main.a && printf "%-16s%-12s%-6s%-6s%-8s%-10s\\140\\n" f.o 0 0 0 644 "$n" && cat f.o && { [ $((n % 2)) -eq 0 ] || printf "\\n"; }; } > prog.a';

export default async function asm(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: 'gopher' });
  const cwd = '/home/gopher/asm';
  const run = (argv) => ctx.run(argv, { cwd, user: 'gopher' });
  const headers = await ctx.run(['find', `${GOROOT}/pkg/include`, '-name', '*.h'], { cwd: '/' });
  assert.equal(headers.status, 0, `goroot/pkg/include: ${headers.stderr}`);
  const names = headers.stdout.trim().split('\n').map((p) => p.slice(p.lastIndexOf('/') + 1)).sort();
  for (const h of ['funcdata.h', 'textflag.h']) assert.ok(names.includes(h), `goroot/pkg/include has ${h} (${names.join(' ')})`);
  await ctx.write(`${cwd}/f.s`, ASM);
  await ctx.write(`${cwd}/main.go`, MAIN);
  const bare = await run([`${TOOLS}/asm`, '-p', 'main', '-o', 'bare.o', 'f.s']);
  assert.notEqual(bare.status, 0, 'asm without -I finds no textflag.h, as upstream Go: go build passes -I $GOROOT/pkg/include');
  assert.match(bare.stderr, /textflag\.h/, bare.stderr);
  const inc = ['-I', `${GOROOT}/pkg/include`];
  const sym = await run([`${TOOLS}/asm`, '-p', 'main', ...inc, '-gensymabis', '-o', 'symabis', 'f.s']);
  assert.equal(sym.status, 0, `asm -gensymabis: ${sym.stdout}${sym.stderr}`);
  await ctx.write(`${cwd}/importcfg`, await importcfg(ctx, STD));
  const c = await run([`${TOOLS}/compile`, '-o', 'main.a', '-p', 'main', '-importcfg', 'importcfg', '-symabis', 'symabis', '-pack', 'main.go']);
  assert.equal(c.status, 0, `compile: ${c.stdout}${c.stderr}`);
  const o = await run([`${TOOLS}/asm`, '-p', 'main', ...inc, '-o', 'f.o', 'f.s']);
  assert.equal(o.status, 0, `asm with -I goroot/pkg/include: ${o.stdout}${o.stderr}`);
  const p = await run(['bash', '-c', PACK]);
  assert.equal(p.status, 0, `appending f.o to main.a: ${p.stderr}`);
  await ctx.write(`${cwd}/importcfg.link`, await importcfg(ctx, STD, ['packagefile main=prog.a']));
  const l = await run([`${TOOLS}/link`, '-o', 'prog.wasm', '-importcfg', 'importcfg.link', '-buildmode=exe', 'prog.a']);
  assert.equal(l.status, 0, `link: ${l.stdout}${l.stderr}`);
  const r = await run([`${cwd}/prog.wasm`]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'asm says 42\n', 'a Go program calling a textflag.h assembly function runs in the kernel');
}
