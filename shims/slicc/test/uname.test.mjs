import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createNodeKernel } from 'slicc-kernel-current/node'
import { createNodeKernel as createNew } from 'slicc-kernel-hosts/node'
import { createNodeKernel as createOld } from 'slicc-kernel-1-26/node'

const out = new URL('./out/', import.meta.url)

async function boot (create, options = {}) {
  const kernel = await create(options)
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
  return kernel
}

test('uname is the env.__syscall_uname import', async () => {
  const wasm = await readFile(new URL('uname-test.wasm', out))
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm))
  assert.ok(imports.some((i) => i.module === 'env' && i.name === '__syscall_uname' && i.kind === 'function'), 'no env.__syscall_uname import')
  const glue = await readFile(new URL('uname-test', out), 'utf8')
  assert.match(glue, /___syscall_uname/)
})

// Kernels before slicc-kernel#625 don't answer uname(2), so the import's
// default body does: the node name is /etc/hostname's first line, else
// HOSTNAME, else "slicc" (homescoop#1462, slicc-kernel#1296), not
// Emscripten's "emscripten". 1.69.0 sets HOSTNAME to its node name; 1.26.6
// sets none.
test('a kernel that doesn\'t answer uname: the node name from /etc/hostname, HOSTNAME, then slicc', async () => {
  const old = await boot(createOld)
  const none = await old.run(['uname-test'], { cwd: '/tmp' })
  assert.equal(none.status, 0, `${none.stdout}${none.stderr}`)
  assert.equal(none.stdout, 'Emscripten|slicc|4.0.23|#1|wasm32\nnull -1 EFAULT\n')
  await old.terminate()
  const kernel = await boot(createNodeKernel, { hostname: 'box-env' })
  const env = await kernel.run(['uname-test'], { cwd: '/tmp' })
  assert.equal(env.stdout.split('\n')[0], 'Emscripten|box-env|4.0.23|#1|wasm32')
  await kernel.writeFile('/etc/hostname', '  \n')
  const blank = await kernel.run(['uname-test'], { cwd: '/tmp' })
  assert.equal(blank.stdout.split('\n')[0], 'Emscripten|box-env|4.0.23|#1|wasm32', 'a blank /etc/hostname is no name')
  await kernel.writeFile('/etc/hostname', '  box7 \nsecond\n')
  const file = await kernel.run(['uname-test'], { cwd: '/tmp' })
  assert.equal(file.stdout.split('\n')[0], 'Emscripten|box7|4.0.23|#1|wasm32')
  await kernel.terminate()
})

test('a kernel that answers uname (1.137.0) keeps its own answer', async () => {
  const kernel = await boot(createNew)
  const r = await kernel.run(['uname-test'], { cwd: '/tmp' })
  assert.equal(r.stdout, 'Linux|slicc|6.0.0-slicc|#1 SMP PREEMPT_DYNAMIC|wasm32\nnull -1 EFAULT\n')
  await kernel.terminate()
})
