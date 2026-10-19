import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHost, createImports, envObject, fromBase64, PROBE, responseHeaders, toBase64 } from '../package/host/ntfy-host.mjs'

const bytes = text => new TextEncoder().encode(text)
const text = value => new TextDecoder().decode(fromBase64(value))

function fakeCtx ({ child = { status: 0, stdout: [], stderr: [] }, net = {} } = {}) {
  const calls = []
  const reads = new Map()
  let next = 1
  const results = new Map()
  const ctx = {
    calls,
    cwd: () => '/home/app',
    mem: new WebAssembly.Memory({ initial: 1 }),
    memory: () => ctx.mem,
    spawn: options => {
      calls.push(['spawn', options])
      if (child.missing) throw Object.assign(new Error('not found'), { code: 'ENOENT' })
      const out = { pid: 7 }
      if (options.stdin === 'pipe') out.stdin = 10
      if (options.stdout === 'pipe') { out.stdout = 11; reads.set(11, child.stdout.map(bytes)) }
      if (options.stderr === 'pipe') { out.stderr = 12; reads.set(12, child.stderr.map(bytes)) }
      return out
    },
    wait: pid => {
      calls.push(['wait', pid])
      return { status: child.status }
    },
    syscall: request => {
      calls.push(['syscall', request.op, request.fd ?? request.handle])
      if (request.op === 'net-request') return { handle: 3, status: net.status ?? 200, headers: net.headers ?? [] }
      if (request.op === 'net-read') return net.chunks?.length ? bytes(net.chunks.shift()) : new Uint8Array(0)
      return null
    },
    async: {
      submit: request => {
        const id = next++
        calls.push(['submit', request.op, request.fd])
        if (request.op === 'fd-read') results.set(id, { value: reads.get(request.fd).shift() ?? new Uint8Array(0) })
        else results.set(id, { value: request.body.length })
        return id
      },
      wait: () => results.keys().next().value,
      take: id => {
        const value = results.get(id)
        results.delete(id)
        return value
      },
    },
  }
  return ctx
}

test('run inherits the stdio ntfy asks for and pipes the rest', () => {
  const ctx = fakeCtx({ child: { status: 3, stdout: [], stderr: ['oops'] } })
  const result = createHost(ctx)({ op: 'run', argv: ['sh', '-c', 'echo hi'], env: ['NTFY_ID=a1', 'HOME=/home/app'], stdin: 'inherit', stdout: 'inherit' })
  const spawn = ctx.calls.find(([kind]) => kind === 'spawn')[1]
  assert.deepEqual(spawn, { argv: ['sh', '-c', 'echo hi'], env: { NTFY_ID: 'a1', HOME: '/home/app' }, cwd: '/home/app', stdin: 'inherit', stdout: 'inherit', stderr: 'pipe' })
  assert.equal(result.status, 3)
  assert.equal(text(result.stdout), '')
  assert.equal(text(result.stderr), 'oops')
})

test('run writes piped input and collects output', () => {
  const ctx = fakeCtx({ child: { status: 0, stdout: ['a', 'b'], stderr: [] } })
  const result = createHost(ctx)({ op: 'run', argv: ['cat'], env: [], input: toBase64(bytes('in')) })
  assert.equal(text(result.stdout), 'ab')
  assert.ok(ctx.calls.some(([kind, op, fd]) => kind === 'submit' && op === 'fd-write' && fd === 10))
})

test('run names a missing command as exec does', () => {
  const ctx = fakeCtx({ child: { missing: true } })
  assert.throws(() => createHost(ctx)({ op: 'run', argv: ['nope'], env: [] }), /exec: "nope": executable file not found in \$PATH/)
  assert.throws(() => createHost(ctx)({ op: 'run', argv: [], env: [] }), /argv of strings/)
})

test('http, http.read and http.close map to net-request, net-read and net-close', () => {
  const ctx = fakeCtx({ net: { status: 429, headers: [['Retry-After', '60'], ['Content-Encoding', 'gzip'], ['Content-Length', '9']], chunks: ['{"a":1}\n'] } })
  const host = createHost(ctx)
  const head = host({ op: 'http', method: 'GET', url: 'https://ntfy.sliccy.ai/t/json', headers: [['Authorization', 'Bearer tk_x']] })
  assert.deepEqual(head, { handle: 3, status: 429, headers: [['Retry-After', '60']] })
  assert.equal(text(host({ op: 'http.read', handle: 3 })), '{"a":1}\n')
  assert.equal(text(host({ op: 'http.read', handle: 3 })), '')
  assert.equal(host({ op: 'http.close', handle: 3 }), null)
  assert.throws(() => host({ op: 'http', url: 'file:///etc/passwd' }), /unsupported protocol file:/)
  assert.throws(() => host({ op: 'chmod' }), /unknown ntfy_host operation chmod/)
})

test('helpers', () => {
  assert.deepEqual(envObject(['A=1', 'B=x=y', 'bad']), { A: '1', B: 'x=y' })
  assert.deepEqual(responseHeaders({ headers: [['content-encoding', 'zstd']] }), [['content-encoding', 'zstd']])
  assert.deepEqual(responseHeaders({ decoded: false, headers: [['content-encoding', 'gzip']] }), [['content-encoding', 'gzip']])
})

test('createImports answers the probe and frames calls as JSON', () => {
  const ctx = fakeCtx()
  const { ntfy_host: host } = createImports(ctx)
  assert.equal(host.probe(), PROBE)
  const request = bytes(JSON.stringify({ op: 'nope' }))
  new Uint8Array(ctx.mem.buffer).set(request, 64)
  const size = host.call(64, request.length)
  host.take(1024)
  const response = JSON.parse(new TextDecoder().decode(new Uint8Array(ctx.mem.buffer, 1024, size)))
  assert.deepEqual(response, { ok: false, error: 'unknown ntfy_host operation nope' })
})
