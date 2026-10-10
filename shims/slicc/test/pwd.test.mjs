// getpwuid / getpwnam / getpwent / getgr* through slicc_pwd.c, reading the
// kernel's synthesized /etc/passwd and /etc/group, getgrent included (screen needs it:
// "getpwuid() can't identify your account!").
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createNodeKernel } from '@ai-ecoverse/slicc-kernel/node'
import { createNodeKernel as createOldKernel } from 'slicc-kernel-1-26/node'

const out = new URL('./out/', import.meta.url)

async function boot (create) {
  const kernel = await create({})
  const manifest = {
    name: 'pwd-test',
    version: '0.0.0',
    slicc: { abi: 'emscripten', commands: { 'pwd-test': { glue: 'bin/pwd-test', wasm: 'bin/pwd-test.wasm' } } },
  }
  await kernel.writeFile('/node_modules/pwd-test/package.json', JSON.stringify(manifest))
  for (const f of ['pwd-test', 'pwd-test.wasm']) {
    await kernel.writeFile(`/node_modules/pwd-test/bin/${f}`, await readFile(new URL(f, out)))
  }
  await kernel.writeFile('/tmp/.keep', '')
  return kernel
}

const show = r => `status ${r.status}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`

for (const [label, create] of [['slicc-kernel 1.26.6', createOldKernel], ['slicc-kernel current', createNodeKernel]]) {
  test(`${label}: passwd and group lookups read the kernel's /etc files`, async () => {
    const kernel = await boot(create)
    const r = await kernel.run(['pwd-test'])
    assert.equal(r.status, 0, show(r))
    assert.equal(r.stdout, [
      'flock 0',
      'uid web_user:x:1000:1000:web_user:/home:/bin/bash',
      'root root:x:0:0:root:/root:/bin/sh',
      'nobody none',
      'uid4242 none',
      'r-small 68 null', // ERANGE (68 in Emscripten's errno numbering)
      'r-big 0 /home',
      'r-missing 0 null',
      'ent 0 root',
      'ent 1 web_user',
      'grent 0 root',
      'grent 1 web_user',
      'grent end errno 0',
      'gid web_user:1000:',
      'rootgr root:0:',
      'nogr none',
      '',
    ].join('\n'), show(r))
    await kernel.terminate()
  })
}
