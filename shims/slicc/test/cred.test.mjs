// Process credentials through slicc_libc_gaps.c (homescoop#207): ids from
// slicc-kernel K1's Module.sliccKernel.cred(), set*id through setcred(), names
// from its /etc/passwd and /etc/group. K1 is slicc-kernel#251: until it is
// released, point SLICC_K1_KERNEL at a build's dist/node.js; without it the
// test is skipped. The lines match wasix-sysroot's test/r20.c.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { createNodeKernel as createPreK1 } from '@ai-ecoverse/slicc-kernel/node'

const out = new URL('./out/', import.meta.url)
const k1 = process.env.SLICC_K1_KERNEL

const want = {
  root: [
    'ids: uid=0 euid=0 gid=0 egid=0 res=0:0/0,0,0/0,0,0',
    'groups: n=1 m=1 0 small=-2 errno=0',
    'pwuid: root /root /bin/bash',
    'grgid: root',
    'pwnam root: uid=0 dir=/root',
    'pwnam 1000: no static user',
    'seteuid 1000: uid=0 euid=1000 gid=0 egid=0 res=0:0/0,1000,0/0,0,0',
    'root seteuid: 0 0 errno=0 euid=0',
    'root setgroups: 0 count=2',
    'root drop: 0 setuid0=-1 errno=EPERM',
    'dropped: uid=1000 euid=1000 gid=0 egid=0 res=0:0/1000,1000,1000/0,0,0',
    'cred done',
  ],
  cone: [
    'ids: uid=1000 euid=1000 gid=1000 egid=1000 res=0:0/1000,1000,1000/1000,1000,1000',
    'groups: n=2 m=2 1000 100 small=-1 errno=28',
    'pwuid: cone /home/cone /bin/bash',
    'grgid: cone',
    'pwnam root: uid=0 dir=/root',
    'pwnam 1000: no static user',
    'user setuid0: -1 errno=EPERM',
    'user setgroups: -1 errno=EPERM',
    'user setuid self: 0',
    'cred done',
  ],
}

test('slicc-kernel K1: credentials from the kernel, as root and as a user', { skip: !k1 && 'SLICC_K1_KERNEL not set' }, async () => {
  const { createNodeKernel } = await import(pathToFileURL(k1).href)
  const kernel = await createNodeKernel({})
  const manifest = {
    name: 'cred-test',
    version: '0.0.0',
    slicc: { abi: 'emscripten', commands: { 'cred-test': { glue: 'bin/cred-test', wasm: 'bin/cred-test.wasm' } } },
  }
  await kernel.writeFile('/node_modules/cred-test/package.json', JSON.stringify(manifest))
  for (const f of ['cred-test', 'cred-test.wasm']) {
    await kernel.writeFile(`/node_modules/cred-test/bin/${f}`, await readFile(new URL(f, out)))
  }
  await kernel.users.add({ name: 'cone' })
  for (const user of ['root', 'cone']) {
    const r = await kernel.run(['cred-test'], { cwd: '/tmp', ...(user === 'cone' && { user }) })
    assert.equal(r.status, 0, `${user}: ${r.stdout}${r.stderr}`)
    assert.deepEqual(r.stdout.trim().split('\n'), want[user], `${user}:\n${r.stdout}${r.stderr}`)
  }
  await kernel.terminate()
})

// No fallback to uid 1000 (homescoop#207): on a kernel without credentials
// the getters return -1 and the setters fail with ENOSYS.
test('a kernel without users: ids -1, set*id ENOSYS', async () => {
  const kernel = await createPreK1({})
  const manifest = {
    name: 'cred-test',
    version: '0.0.0',
    slicc: { abi: 'emscripten', commands: { 'cred-test': { glue: 'bin/cred-test', wasm: 'bin/cred-test.wasm' } } },
  }
  await kernel.writeFile('/node_modules/cred-test/package.json', JSON.stringify(manifest))
  for (const f of ['cred-test', 'cred-test.wasm']) {
    await kernel.writeFile(`/node_modules/cred-test/bin/${f}`, await readFile(new URL(f, out)))
  }
  await kernel.writeFile('/tmp/.keep', '')
  const r = await kernel.run(['cred-test'], { cwd: '/tmp' })
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
  const lines = r.stdout.trim().split('\n')
  assert.match(lines[0], /^ids: uid=-1 euid=-1 gid=-1 egid=-1 res=-1:-1\//)
  assert.deepEqual(lines.slice(1), [
    'groups: n=-1 m=-1 small=-2 errno=0',
    'pwuid: - - -',
    'grgid: -',
    'pwnam root: uid=0 dir=/root',
    'pwnam 1000: no static user',
    'user setuid0: -1 errno=Function not implemented',
    'user setgroups: -1 errno=Function not implemented',
    'user setuid self: -1',
    'cred done',
  ], r.stdout)
  await kernel.terminate()
})
