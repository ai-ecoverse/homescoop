import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createNodeKernel } from 'slicc-kernel-current/node'

const out = new URL('./out/', import.meta.url)

async function boot () {
  const kernel = await createNodeKernel({})
  const name = 'siginherit-test'
  const manifest = { name, version: '0.0.0', slicc: { abi: 'emscripten', commands: { [name]: { glue: `bin/${name}`, wasm: `bin/${name}.wasm` } } } }
  await kernel.writeFile(`/node_modules/${name}/package.json`, JSON.stringify(manifest))
  for (const f of [name, `${name}.wasm`]) {
    await kernel.writeFile(`/node_modules/${name}/bin/${f}`, await readFile(new URL(f, out)), { mode: 0o755 })
  }
  return kernel
}

test('slicc_signals.c seeds nothing on a kernel without sliccKernel.sigInherited: the program starts with the defaults and runs (homescoop#973)', async () => {
  const kernel = await boot()
  try {
    const r = await kernel.run(['siginherit-test'], { cwd: '/' })
    assert.deepEqual(r, { status: 0, stdout: 'SIGPIPE default, SIGHUP default, SIGINT default\n', stderr: '' })
  } finally {
    kernel.terminate()
  }
})
