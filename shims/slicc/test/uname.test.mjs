import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createNodeKernel } from 'slicc-kernel-current/node'

const out = new URL('./out/', import.meta.url)

test('uname is the env.__syscall_uname import, whose default body answers what Emscripten\'s stub did', async () => {
  const wasm = await readFile(new URL('uname-test.wasm', out))
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm))
  assert.ok(imports.some((i) => i.module === 'env' && i.name === '__syscall_uname' && i.kind === 'function'), 'no env.__syscall_uname import')
  const glue = await readFile(new URL('uname-test', out), 'utf8')
  assert.match(glue, /___syscall_uname/)
  const kernel = await createNodeKernel({})
  const manifest = {
    name: 'uname-test',
    version: '0.0.0',
    slicc: { abi: 'emscripten', commands: { 'uname-test': { glue: 'bin/uname-test', wasm: 'bin/uname-test.wasm' } } },
  }
  await kernel.writeFile('/node_modules/uname-test/package.json', JSON.stringify(manifest))
  for (const f of ['uname-test', 'uname-test.wasm']) {
    await kernel.writeFile(`/node_modules/uname-test/bin/${f}`, await readFile(new URL(f, out)))
  }
  await kernel.writeFile('/tmp/.keep', '')
  const r = await kernel.run(['uname-test'], { cwd: '/tmp' })
  await kernel.terminate()
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
  assert.equal(r.stdout, 'Emscripten|emscripten|4.0.23|#1|wasm32\nnull -1 EFAULT\n')
})
