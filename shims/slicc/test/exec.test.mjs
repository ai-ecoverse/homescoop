// exec through slicc_exec.c keeps the caller's pid (slicc-kernel#176): the
// shim calls Module.sliccKernel.execve, which sends the spawn with
// `exec: true`, so the kernel links the new image to the pid before it
// starts. Checked on 1.26.6, which has no identity wait (#171), so a pass
// there comes from the shim alone, and on the current kernel.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createNodeKernel } from '@ai-ecoverse/slicc-kernel/node'
import { createNodeKernel as createOldKernel } from 'slicc-kernel-1-26/node'

const out = new URL('./out/', import.meta.url)
const PROGRAMS = ['exec-test', 'exec-test-fork']

async function boot (create) {
  const kernel = await create({})
  for (const name of PROGRAMS) {
    const manifest = {
      name,
      version: '0.0.0',
      slicc: { abi: 'emscripten', commands: { [name]: { glue: `bin/${name}`, wasm: `bin/${name}.wasm` } } },
    }
    await kernel.writeFile(`/node_modules/${name}/package.json`, JSON.stringify(manifest))
    for (const f of [name, `${name}.wasm`]) {
      await kernel.writeFile(`/node_modules/${name}/bin/${f}`, await readFile(new URL(f, out)))
    }
  }
  await kernel.writeFile('/tmp/.keep', '')
  return kernel
}

const show = r => `status ${r.status}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`

// "L<n> <getpid> <readlink /proc/self>" lines → [{ n, pid, self }]
const levels = stdout => stdout.trim().split('\n').filter(l => l.startsWith('L')).map(l => {
  const [tag, pid, self] = l.split(' ')
  return { n: Number(tag.slice(1)), pid: Number(pid), self: Number(self) }
})

for (const [label, create] of [['slicc-kernel 1.26.6 (no #171)', createOldKernel], ['slicc-kernel current', createNodeKernel]]) {
  for (const program of PROGRAMS) {
    test(`${label}: ${program}: a 3-level exec chain keeps one pid`, async () => {
      const kernel = await boot(create)
      for (let round = 0; round < 5; round++) {
        const r = await kernel.run([program, '3'])
        assert.equal(r.status, 0, show(r))
        const ls = levels(r.stdout)
        assert.deepEqual(ls.map(l => l.n), [3, 2, 1, 0], show(r))
        const pid = ls[0].pid
        for (const l of ls) {
          assert.equal(l.pid, pid, `getpid changed across exec\n${show(r)}`)
          assert.equal(l.self, pid, `/proc/self disagrees with getpid\n${show(r)}`)
        }
      }
      await kernel.terminate()
    })
  }

  test(`${label}: exec-test-fork: fork, then exec in the child, keeps the fork's pid`, async () => {
    const kernel = await boot(create)
    for (let round = 0; round < 5; round++) {
      const r = await kernel.run(['exec-test-fork', '2', 'fork'])
      assert.equal(r.status, 0, show(r))
      const child = Number(/^child (\d+)$/m.exec(r.stdout)?.[1])
      const ls = levels(r.stdout)
      assert.deepEqual(ls.map(l => l.n), [2, 1, 0], show(r))
      for (const l of ls) {
        assert.equal(l.pid, child, `exec'd child is not the forked pid\n${show(r)}`)
        assert.equal(l.self, child, show(r))
      }
    }
    await kernel.terminate()
  })
}
