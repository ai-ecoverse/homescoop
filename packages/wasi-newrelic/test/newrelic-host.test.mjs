import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAsyncHost, createAsyncImports, createHost, createImports, fromBase64, PROBE, responseHeaders, toBase64 } from '../package/host/newrelic-host.mjs'

const bytes = text => new TextEncoder().encode(text)
const b64 = text => toBase64(bytes(text))
const text = value => new TextDecoder().decode(fromBase64(value))

function fakeCtx ({ net = {} } = {}) {
  const calls = []
  const modes = []
  const ctx = {
    calls,
    modes,
    memory: () => ctx.mem,
    mem: new WebAssembly.Memory({ initial: 1 }),
    fs: { chmod: (path, mode) => { modes.push([path, mode]) } },
    syscall: request => {
      calls.push(request)
      if (request.op === 'net-request') {
        if (net.fail) throw Object.assign(new Error('down'), { code: net.fail })
        return { handle: 9, status: net.status ?? 200, headers: net.headers ?? [], ...(net.decoded === false ? { decoded: false } : {}) }
      }
      if (request.op === 'net-read') return net.chunks?.length ? bytes(net.chunks.shift()) : new Uint8Array(0)
      if (request.op === 'net-close') return null
      throw new Error(`unexpected syscall ${request.op}`)
    },
  }
  return ctx
}

// The async process host's ctx: every call that reaches the kernel answers a
// promise, and a failure is a rejection.
function asyncCtx (ctx) {
  const later = fn => (...args) => {
    try {
      return Promise.resolve(fn(...args))
    } catch (error) {
      return Promise.reject(error)
    }
  }
  return { ...ctx, fs: { chmod: later(ctx.fs.chmod) }, syscall: later(ctx.syscall) }
}

test('probe answers the magic the wasm import checks ("nrcl")', () => {
  const { newrelic_host: host } = createImports(fakeCtx())
  assert.equal(host.probe(), PROBE)
  assert.equal(PROBE, 0x6e72636c)
})

test('responseHeaders drops content-encoding after the kernel decoded the body', () => {
  assert.deepEqual(responseHeaders({ headers: [['Content-Encoding', 'gzip'], ['Content-Length', '4'], ['Content-Type', 'application/json']] }), [['Content-Type', 'application/json']])
  assert.deepEqual(responseHeaders({ decoded: false, headers: [['Content-Encoding', 'gzip']] }), [['Content-Encoding', 'gzip']])
  assert.deepEqual(responseHeaders({ headers: [['Content-Encoding', 'zstd']] }), [['Content-Encoding', 'zstd']])
})

test('http sends method, headers and body to net-request, reads the body and closes the handle', () => {
  const ctx = fakeCtx({ net: { status: 200, headers: [['Content-Type', 'application/json']], chunks: ['{"data":{"actor":{"user":{"name":"Cert"}}}}'] } })
  const host = createHost(ctx)
  const head = host({ op: 'http', method: 'POST', url: 'https://api.newrelic.com/graphql', headers: [['Api-Key', 'placeholder']], body: b64('{"query":"{ actor { user { name } } }"}') })
  assert.deepEqual(head, { handle: 9, status: 200, headers: [['Content-Type', 'application/json']] })
  const sent = ctx.calls[0]
  assert.equal(sent.op, 'net-request')
  assert.equal(sent.url, 'https://api.newrelic.com/graphql')
  assert.equal(sent.method, 'POST')
  assert.deepEqual(sent.headers, [['Api-Key', 'placeholder']])
  assert.equal(new TextDecoder().decode(sent.body), '{"query":"{ actor { user { name } } }"}')
  assert.equal(text(host({ op: 'http.read', handle: head.handle })), '{"data":{"actor":{"user":{"name":"Cert"}}}}')
  assert.equal(text(host({ op: 'http.read', handle: head.handle })), '')
  assert.equal(host({ op: 'http.close', handle: head.handle }), null)
  assert.deepEqual(ctx.calls.map(call => call.op), ['net-request', 'net-read', 'net-read', 'net-close'])
})

test('http without a body sends none, and refuses what is not http or https', () => {
  const ctx = fakeCtx()
  const host = createHost(ctx)
  host({ op: 'http', url: 'https://api.newrelic.com/graphql' })
  assert.equal(ctx.calls[0].method, 'GET')
  assert.equal('body' in ctx.calls[0], false)
  assert.throws(() => host({ op: 'http', url: 'file:///etc/passwd' }), /unsupported protocol file:/)
  assert.throws(() => host({ op: 'http', url: 'not a url' }), /invalid URL not a url/)
})

test('http reports an unreachable host by name and code', () => {
  const host = createHost(fakeCtx({ net: { fail: 'ENETUNREACH' } }))
  assert.throws(() => host({ op: 'http', url: 'https://api.newrelic.com/' }), /could not reach api\.newrelic\.com \(ENETUNREACH\)/)
})

test('chmod sets permission bits on the kernel file and refuses anything else', () => {
  const ctx = fakeCtx()
  const host = createHost(ctx)
  assert.equal(host({ op: 'chmod', path: '/home/app/.newrelic/credentials.json', mode: 0o600 }), null)
  assert.deepEqual(ctx.modes, [['/home/app/.newrelic/credentials.json', 0o600]])
  for (const bad of [{ path: '', mode: 0o600 }, { path: '/x', mode: 0o4755 }, { path: '/x', mode: -1 }, { path: '/x', mode: '600' }, { mode: 0o600 }]) {
    assert.throws(() => host({ op: 'chmod', ...bad }), /chmod needs a path and permission bits/)
  }
  assert.equal(ctx.modes.length, 1)
})

test('there are no command operations', () => {
  const host = createHost(fakeCtx())
  for (const op of ['run', 'which', 'nope']) {
    assert.throws(() => host({ op, argv: ['sh'] }), new RegExp(`unknown newrelic_host operation ${op}`))
  }
})

test('createImports exchanges JSON through call and take', () => {
  const ctx = fakeCtx()
  const { newrelic_host: host } = createImports(ctx)
  const request = bytes(JSON.stringify({ op: 'chmod', path: '/home/app/.newrelic', mode: 0o700 }))
  const memory = new Uint8Array(ctx.memory().buffer)
  memory.set(request, 256)
  const size = host.call(256, request.length)
  host.take(0)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(memory.slice(0, size))), { ok: true, value: null })
  const bad = bytes('{"op":"nope"}')
  memory.set(bad, 256)
  const failed = host.call(256, bad.length)
  host.take(0)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(memory.slice(0, failed))), { ok: false, error: 'unknown newrelic_host operation nope' })
})

test('base64 round trip', () => {
  assert.equal(text(b64('newrelic')), 'newrelic')
  assert.equal(fromBase64('').length, 0)
})

test('createAsyncHost answers the same operations over a ctx of promises', async () => {
  const ctx = asyncCtx(fakeCtx({ net: { chunks: ['{"data":{}}'] } }))
  const host = createAsyncHost(ctx)
  const head = await host({ op: 'http', method: 'GET', url: 'https://api.newrelic.com/graphql', headers: [['Api-Key', 'placeholder']] })
  assert.equal(head.status, 200)
  assert.equal(text(await host({ op: 'http.read', handle: head.handle })), '{"data":{}}')
  assert.equal(await host({ op: 'http.close', handle: head.handle }), null)
  assert.equal(await host({ op: 'chmod', path: '/home/app/.newrelic/credentials.json', mode: 0o600 }), null)
  await assert.rejects(host({ op: 'nope' }), /unknown newrelic_host operation nope/)
  const down = createAsyncHost(asyncCtx(fakeCtx({ net: { fail: 'ECONNREFUSED' } })))
  await assert.rejects(down({ op: 'http', url: 'https://api.newrelic.com/' }), /could not reach api\.newrelic\.com \(ECONNREFUSED\)/)
})

test('createAsyncImports gives newrelic_host.call as an async function, so the kernel suspends newrelic.wasm', async () => {
  const ctx = asyncCtx(fakeCtx())
  const { newrelic_host: host } = createAsyncImports(ctx)
  assert.equal(host.call.constructor.name, 'AsyncFunction')
  assert.equal(host.probe(), PROBE)
  const request = bytes(JSON.stringify({ op: 'chmod', path: '/home/app/.newrelic', mode: 0o700 }))
  const memory = new Uint8Array(ctx.memory().buffer)
  memory.set(request, 256)
  const size = await host.call(256, request.length)
  host.take(0)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(memory.slice(0, size))), { ok: true, value: null })
})
