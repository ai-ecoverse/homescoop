// setrlimit / getrlimit / prlimit through slicc_libc_gaps.c (homescoop#178).
// Emscripten's stub refused every change with EPERM, so `ulimit -S -n 64`
// failed in bash. rlimit-test, linked with the `cli` profile, on slicc-kernel's
// Node entry: soft limits move up to the hard one, hard limits only down.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createNodeKernel } from 'slicc-kernel-current/node'

const out = new URL('./out/', import.meta.url)

test('soft limits move up to the hard limit, hard limits only down; other pids and resources refused', async () => {
  const wasm = await readFile(new URL('rlimit-test.wasm', out))
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm)).map((i) => i.name)
  assert.ok(!imports.includes('__syscall_prlimit64'), `prlimit64 is an import: ${imports.join(' ')}`)
  const kernel = await createNodeKernel({})
  const manifest = {
    name: 'rlimit-test',
    version: '0.0.0',
    slicc: { abi: 'emscripten', commands: { 'rlimit-test': { glue: 'bin/rlimit-test', wasm: 'bin/rlimit-test.wasm' } } },
  }
  await kernel.writeFile('/node_modules/rlimit-test/package.json', JSON.stringify(manifest))
  for (const f of ['rlimit-test', 'rlimit-test.wasm']) {
    await kernel.writeFile(`/node_modules/rlimit-test/bin/${f}`, await readFile(new URL(f, out)))
  }
  await kernel.writeFile('/tmp/.keep', '')
  const r = await kernel.run(['rlimit-test'], { cwd: '/tmp' })
  await kernel.terminate()
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
  assert.equal(r.stdout, [
    'nofile 0 0 4096 4096',
    'soft-64 0 0 64 4096',
    'soft-back 0 0 4096 4096',
    'hard-up -1 EPERM 4096 4096',
    'soft-over-hard -1 EINVAL 4096 4096',
    'hard-down 0 0 512 1024',
    'hard-back-up -1 EPERM 512 1024',
    'core 0 0 -1 -1',
    'core-0 0 0 0 -1',
    'stack-set 1',
    'other-pid -1 EPERM',
    'bad-resource -1 EINVAL',
    '',
  ].join('\n'))
})
