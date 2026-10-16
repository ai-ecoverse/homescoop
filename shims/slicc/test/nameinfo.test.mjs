// getnameinfo in slicc_socket.c (homescoop#176): /etc/hosts and loopback,
// never the uplink. nameinfo-test, linked with the `net` shim profile as curl
// and rsync are, on slicc-kernel's Node entry. Emscripten's JS getnameinfo
// (what programs had before) named only its own fake-DNS addresses, so
// 127.0.0.1 with NI_NAMEREQD was EAI_NONAME and rsync's daemon logged
// "connect from UNKNOWN (127.0.0.1)".
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createNodeKernel as createOldKernel } from '@ai-ecoverse/slicc-kernel/node'
import { fakeUplink } from '@ai-ecoverse/slicc-kernel/testing'
import { createNodeKernel } from 'slicc-kernel-current/node'

const out = new URL('./out/', import.meta.url)
const manifest = {
  name: 'nameinfo-test',
  version: '0.0.0',
  slicc: { abi: 'emscripten', commands: { 'nameinfo-test': { glue: 'bin/nameinfo-test', wasm: 'bin/nameinfo-test.wasm' } } },
}

async function boot (create, options = {}) {
  const kernel = await create(options)
  await kernel.writeFile('/node_modules/nameinfo-test/package.json', JSON.stringify(manifest))
  for (const f of ['nameinfo-test', 'nameinfo-test.wasm']) {
    await kernel.writeFile(`/node_modules/nameinfo-test/bin/${f}`, await readFile(new URL(f, out)))
  }
  return kernel
}

const show = r => `status ${r.status}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`

test('the wasm has its own getnameinfo, not an import of Emscripten\'s JS one', async () => {
  const mod = new WebAssembly.Module(await readFile(new URL('nameinfo-test.wasm', out)))
  const imports = WebAssembly.Module.imports(mod).map(i => i.name)
  assert.ok(!imports.includes('getnameinfo'), imports.join(' '))
})

test('loopback, the node\'s own address and host.slicc.internal have names; nothing asks the uplink', async () => {
  const net = fakeUplink({ names: { 'peer.tail1234.ts.net': ['100.64.1.2'] }, routes: { prefixes: ['100.64.0.0/10'] } })
  const kernel = await boot(createNodeKernel, { network: { uplink: net } })
  const host = (await kernel.run(['hostname'])).stdout.trim() || 'slicc'
  const cases = [
    [['127.0.0.1', '873', 'namereqd'], 'localhost 873\n'],
    [['127.0.0.1', '873', 'numerichost', 'numericserv'], '127.0.0.1 873\n'],
    [['127.0.0.5', '22', 'namereqd'], 'localhost 22\n'],
    [['127.0.1.1', '0', 'namereqd'], `${host} 0\n`],
    [['10.0.2.2', '8080', 'namereqd'], 'host.slicc.internal 8080\n'],
    [['::1', '443', 'namereqd'], 'localhost 443\n'],
    [['::ffff:127.0.0.1', '80'], 'localhost 80\n'],
    [['100.64.1.2', '873'], '100.64.1.2 873\n'],
    [['192.0.2.7', '80'], '192.0.2.7 80\n'],
    [['--hostbyaddr', '127.0.0.1'], 'localhost\n'],
  ]
  for (const [argv, want] of cases) {
    const r = await kernel.run(['nameinfo-test', ...argv])
    assert.equal(r.status, 0, `${argv.join(' ')}: ${show(r)}`)
    assert.equal(r.stdout, want, argv.join(' '))
  }
  for (const addr of ['100.64.1.2', '192.0.2.7']) {
    const r = await kernel.run(['nameinfo-test', addr, '80', 'namereqd'])
    assert.equal(r.status, 2, show(r))
    assert.match(r.stderr, /Name does not resolve \(-2\)/, show(r))
  }
  // musl's gethostbyaddr asks getnameinfo without NI_NAMEREQD: the numeric form.
  const h = await kernel.run(['nameinfo-test', '--hostbyaddr', '192.0.2.7'])
  assert.equal(h.stdout, '192.0.2.7\n', show(h))
  assert.deepEqual(net.asked, [], `the uplink was asked: ${JSON.stringify(net.asked)}`)
})

test('buffers too small are EAI_OVERFLOW', async () => {
  const kernel = await boot(createNodeKernel)
  for (const argv of [['127.0.0.1', '873', 'nodelen=9'], ['127.0.0.1', '873', 'servlen=3'], ['192.0.2.7', '1', 'nodelen=9']]) {
    const r = await kernel.run(['nameinfo-test', ...argv])
    assert.equal(r.status, 2, `${argv.join(' ')}: ${show(r)}`)
    assert.match(r.stderr, /\(-12\)/, show(r))
  }
  const fits = await kernel.run(['nameinfo-test', '127.0.0.1', '873', 'nodelen=10', 'servlen=4'])
  assert.equal(fits.stdout, 'localhost 873\n', show(fits))
})

test('a kernel without 127.0.1.1 in /etc/hosts (1.28): all of 127.0.0.0/8 is localhost', async () => {
  const kernel = await boot(createOldKernel)
  for (const addr of ['127.0.0.1', '127.0.1.1', '127.255.255.254']) {
    const r = await kernel.run(['nameinfo-test', addr, '0', 'namereqd'])
    assert.equal(r.stdout, 'localhost 0\n', `${addr}: ${show(r)}`)
  }
})
