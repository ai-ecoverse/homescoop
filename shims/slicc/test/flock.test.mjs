import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createNodeKernel } from 'slicc-kernel-current/node'

const out = new URL('./out/', import.meta.url)

test("slicc_libc_gaps.c's flock is the __syscall_flock import, and its default answers 0 on a kernel that doesn't wrap it (homescoop#947)", async () => {
  const kernel = await createNodeKernel({})
  try {
    const name = 'flock-test'
    const manifest = { name, version: '0.0.0', slicc: { abi: 'emscripten', commands: { [name]: { glue: `bin/${name}`, wasm: `bin/${name}.wasm` } } } }
    await kernel.writeFile(`/node_modules/${name}/package.json`, JSON.stringify(manifest))
    for (const f of [name, `${name}.wasm`]) {
      await kernel.writeFile(`/node_modules/${name}/bin/${f}`, await readFile(new URL(f, out)), { mode: 0o755 })
    }
    const glue = await readFile(new URL(name, out), 'utf8')
    assert.match(glue, /function __syscall_flock\(fd,\s*op\)\s*\{\s*return 0;?\s*\}/)
    const r = await kernel.run(['flock-test', 'try', '/tmp/l'], { cwd: '/' })
    assert.deepEqual(r, { status: 0, stdout: 'LOCK_EX|LOCK_NB: ok\n', stderr: '' })
  } finally {
    kernel.terminate()
  }
})
