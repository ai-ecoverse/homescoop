import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { createNodeKernel as createCurrent } from 'slicc-kernel-current/node'
import { createNodeKernel as createSelfKill } from 'slicc-kernel-selfkill/node'

const out = new URL('./out/', import.meta.url)
const other = process.env.SLICC_SELFKILL_KERNEL

const probe = `export default async function (ctx) {
  const lines = [];
  for (const mode of JSON.parse(ctx.argv[1])) {
    const r = ctx.sync.run({ argv: ['selfkill-test', mode] });
    const c = await ctx.spawn({ argv: ['selfkill-test', mode], stdin: 'null', stdout: 'null', stderr: 'null' });
    const w = await c.wait();
    lines.push(JSON.stringify({ mode, run: [r.status, r.signal ?? null], wait: [w.status, w.signal ?? null], out: new TextDecoder().decode(r.stdout).trim() }));
  }
  ctx.sync.write(1, lines.join('\\n') + '\\n');
}
`

async function run(createNodeKernel) {
  const kernel = await createNodeKernel({})
  const manifest = {
    name: 'selfkill-test',
    version: '0.0.0',
    slicc: { abi: 'emscripten', commands: { 'selfkill-test': { glue: 'bin/selfkill-test', wasm: 'bin/selfkill-test.wasm' } } },
  }
  await kernel.writeFile('/node_modules/selfkill-test/package.json', JSON.stringify(manifest))
  for (const f of ['selfkill-test', 'selfkill-test.wasm']) {
    await kernel.writeFile(`/node_modules/selfkill-test/bin/${f}`, await readFile(new URL(f, out)))
  }
  await kernel.writeFile('/node_modules/selfkill-probe/package.json', JSON.stringify({ name: 'selfkill-probe', version: '0.0.0', slicc: { commands: { 'selfkill-probe': { abi: 'js', module: 'probe.mjs' } } } }))
  await kernel.writeFile('/node_modules/selfkill-probe/probe.mjs', probe)
  await kernel.writeFile('/tmp/.keep', '')
  const modes = ['kill-term', 'raise-term', 'raise-kill', 'trap', 'ignore', 'chld', 'exit-143']
  const r = await kernel.run(['selfkill-probe', JSON.stringify(modes)], { cwd: '/tmp' })
  await kernel.terminate()
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
  return Object.fromEntries(r.stdout.trim().split('\n').map((l) => JSON.parse(l)).map((o) => [o.mode, o]))
}

const local = (got) => {
  assert.deepEqual(got.trap.run, [0, null])
  assert.equal(got.trap.out, 'handler 15\nsurvived trap')
  assert.deepEqual(got.ignore.run, [0, null])
  assert.equal(got.ignore.out, 'survived ignore')
  assert.deepEqual(got.chld.run, [0, null])
  assert.equal(got.chld.out, 'survived chld')
  assert.deepEqual(got['exit-143'].run, [143, null])
  assert.deepEqual(got['exit-143'].wait, [143, null])
}

test('slicc-kernel 1.69.0: a self-signal with its default action asks the kernel; caught, ignored and default-ignored signals stay local', async () => {
  const got = await run(createCurrent)
  local(got)
  for (const [mode, status] of [['kill-term', 143], ['raise-term', 143], ['raise-kill', 137]]) {
    assert.equal(got[mode].run[0] ?? 128 + got[mode].run[1], status, `${mode}: ${JSON.stringify(got[mode])}`)
    assert.equal(got[mode].out, '', `${mode} ran on: ${got[mode].out}`)
  }
})

test(`slicc-kernel ${other ?? '1.73.2'} (#456 applies a self-kill): wait and sync.run report the signal`, async () => {
  const got = await run(other ? (await import(pathToFileURL(other).href)).createNodeKernel : createSelfKill)
  local(got)
  for (const [mode, sig] of [['kill-term', 15], ['raise-term', 15], ['raise-kill', 9]]) {
    assert.deepEqual(got[mode].run, [null, sig], `${mode} sync.run: ${JSON.stringify(got[mode])}`)
    assert.deepEqual(got[mode].wait, [128 + sig, sig], `${mode} wait: ${JSON.stringify(got[mode])}`)
  }
})
