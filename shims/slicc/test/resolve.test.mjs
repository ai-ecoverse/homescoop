// getaddrinfo in slicc_socket.c asks the kernel's resolver (homescoop#139):
// resolve-test, linked with the `net` shim profile as curl is, on
// slicc-kernel's Node entry with the testing fake uplink.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createNodeKernel } from '@ai-ecoverse/slicc-kernel/node'
import { fakeUplink } from '@ai-ecoverse/slicc-kernel/testing'
import { createNodeKernel as createOldKernel } from 'slicc-kernel-1-26/node'

const out = new URL('./out/', import.meta.url)
const manifest = {
  name: 'resolve-test',
  version: '0.0.0',
  slicc: { abi: 'emscripten', commands: { 'resolve-test': { glue: 'bin/resolve-test', wasm: 'bin/resolve-test.wasm' } } },
}

async function boot (create, options) {
  const kernel = await create(options)
  await kernel.writeFile('/node_modules/resolve-test/package.json', JSON.stringify(manifest))
  for (const f of ['resolve-test', 'resolve-test.wasm']) {
    await kernel.writeFile(`/node_modules/resolve-test/bin/${f}`, await readFile(new URL(f, out)))
  }
  await kernel.writeFile('/tmp/.keep', '')
  return kernel
}

// A peer that answers "hello <what it was sent>" and closes.
const echo = conn => {
  void (async () => {
    const chunks = []
    for (;;) {
      const piece = await conn.read()
      if (!piece) break
      chunks.push(Buffer.from(piece))
    }
    conn.write(new TextEncoder().encode(`hello ${Buffer.concat(chunks)}\n`))
    conn.end()
  })()
}

const uplink = () => fakeUplink({
  names: {
    'peer.tail1234.ts.net': ['100.64.1.2', '100.64.1.3', 'fd7a:115c:a1e0::2'],
    'loop.tail1234.ts.net': ['127.0.0.1'],
    'host.tail1234.ts.net': ['10.0.2.2'],
  },
  routes: { prefixes: ['100.64.0.0/10'] },
  peers: { '100.64.1.2:8080': echo },
})

const show = r => `status ${r.status}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`

test('a tailnet name resolves through the uplink and connects', async () => {
  const net = uplink()
  const kernel = await boot(createNodeKernel, { network: { uplink: net } })
  const r = await kernel.run(['resolve-test', 'peer.tail1234.ts.net', '8080', 'shim'])
  assert.equal(r.status, 0, show(r))
  // Every A record, in order; the AAAA one is not asked for (IPv4 sockets).
  assert.equal(r.stdout, '100.64.1.2\n100.64.1.3\nhello shim\n', show(r))
  assert.deepEqual(net.asked.map(a => a.name), ['peer.tail1234.ts.net'])
  assert.ok(net.asked.every(a => a.family === 4), JSON.stringify(net.asked))
  assert.deepEqual(net.dialled, [{ host: '100.64.1.2', port: 8080 }])
})

test('an uplink answer pointing into the kernel is dropped: no such name', async () => {
  const kernel = await boot(createNodeKernel, { network: { uplink: uplink() } })
  for (const name of ['loop.tail1234.ts.net', 'host.tail1234.ts.net', 'nobody.tail1234.ts.net']) {
    const r = await kernel.run(['resolve-test', name])
    assert.equal(r.status, 2, show(r))
    assert.match(r.stderr, new RegExp(`${name.replaceAll('.', '\\.')}: .* \\(-2\\)`), show(r))
  }
})

test('localhost, numeric IPv4 and host.slicc.internal', async () => {
  const kernel = await boot(createNodeKernel, { network: { uplink: uplink() } })
  const cases = [['localhost', '127.0.0.1\n'], ['api.localhost', '127.0.0.1\n'], ['192.0.2.7', '192.0.2.7\n'], ['host.slicc.internal', '10.0.2.2\n']]
  for (const [name, want] of cases) {
    const r = await kernel.run(['resolve-test', name])
    assert.equal(r.status, 0, `${name}: ${show(r)}`)
    assert.equal(r.stdout, want, name)
  }
  const v6 = await kernel.run(['resolve-test', 'fd7a:115c:a1e0::2'])
  assert.equal(v6.status, 2, show(v6))
})

test('no uplink: other names are not found', async () => {
  const kernel = await boot(createNodeKernel, {})
  const r = await kernel.run(['resolve-test', 'peer.tail1234.ts.net'])
  assert.equal(r.status, 2, show(r))
  assert.match(r.stderr, /\(-2\)/)
})

test('a kernel without net.resolve (1.26): as before, EAI_NONAME', async () => {
  const kernel = await boot(createOldKernel, {})
  const r = await kernel.run(['resolve-test', 'peer.tail1234.ts.net'])
  assert.equal(r.status, 2, show(r))
  assert.match(r.stderr, /\(-2\)/)
  const local = await kernel.run(['resolve-test', 'localhost'])
  assert.equal(local.stdout, '127.0.0.1\n', show(local))
})
