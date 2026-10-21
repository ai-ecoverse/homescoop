// posix_spawn file actions (homescoop#1302) and the environment programs get
// (slicc-env.js, homescoop#612): spawn-test, linked with the `cli` shim
// profile, on slicc-kernel's Node entry.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createNodeKernel } from 'slicc-kernel-hosts/node'

const out = new URL('./out/', import.meta.url)
const manifest = {
  name: 'spawn-test',
  version: '0.0.0',
  slicc: { abi: 'emscripten', commands: { 'spawn-test': { glue: 'bin/spawn-test', wasm: 'bin/spawn-test.wasm' } } },
}

async function boot (options = {}) {
  const kernel = await createNodeKernel(options)
  await kernel.writeFile('/node_modules/spawn-test/package.json', JSON.stringify(manifest))
  for (const f of ['spawn-test', 'spawn-test.wasm']) {
    await kernel.writeFile(`/node_modules/spawn-test/bin/${f}`, await readFile(new URL(f, out)))
  }
  await kernel.writeFile('/tmp/.keep', '')
  return kernel
}

const show = r => `status ${r.status}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`

test('a file action whose open() fails returns open\'s errno: ENOENT, EACCES, ENOTDIR', async () => {
  const kernel = await boot({ users: 'enforce' })
  await kernel.users.add({ name: 'cone' })
  await kernel.writeFile('/tmp/secret', 'root only\n', { mode: 0o600 })
  await kernel.writeFile('/tmp/plain', 'x\n')
  const cases = [
    ['r', '/tmp/missing', 'fa ENOENT\n'],
    ['w', '/nonexistent/dir/out', 'fa ENOENT\n'],
    ['r', '/tmp/plain/below', 'fa ENOTDIR\n'],
    ['r', '/tmp/secret', 'fa EACCES\n'],
  ]
  for (const [mode, path, want] of cases) {
    const r = await kernel.run(['spawn-test', 'fa', mode, path], { cwd: '/tmp', user: 'cone' })
    assert.equal(r.status, 0, `${path}: ${show(r)}`)
    assert.equal(r.stdout, want, `${path}: ${show(r)}`)
  }
  const ok = await kernel.run(['spawn-test', 'fa', 'w', '/tmp/out'], { cwd: '/tmp' })
  assert.equal(ok.stdout, 'fa 0\n', show(ok))
  assert.equal(new TextDecoder().decode(await kernel.readFile('/tmp/out')), 'child ran\n')
  await kernel.terminate()
})

test('an empty environment stays empty: no web_user, /home/web_user or PATH=/', async () => {
  const kernel = await boot()
  const r = await kernel.run(['spawn-test', 'env-i'], { cwd: '/tmp' })
  assert.equal(r.status, 0, show(r))
  const env = r.stdout.trim().split('\n').filter(Boolean)
  assert.ok(!r.stdout.includes('web_user'), show(r))
  for (const name of ['HOME', 'USER', 'LOGNAME', 'PATH', 'PWD', 'LANG', '_']) {
    assert.ok(!env.some(e => e.startsWith(`${name}=`)), `${name} set: ${show(r)}`)
  }
  const given = await kernel.run(['spawn-test', 'env'], { cwd: '/tmp', env: { HOME: '/root', FOO: 'bar' } })
  const lines = given.stdout.split('\n')
  assert.ok(lines.includes('HOME=/root') && lines.includes('FOO=bar'), show(given))
  assert.ok(lines.some(e => e.startsWith('PATH=') && e !== 'PATH=/'), show(given))
  await kernel.terminate()
})
