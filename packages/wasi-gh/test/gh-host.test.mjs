import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHost, createImports, envObject, fromBase64, PROBE, responseHeaders, toBase64 } from '../package/host/gh-host.mjs'

const bytes = text => new TextEncoder().encode(text)
const b64 = text => toBase64(bytes(text))
const text = value => new TextDecoder().decode(fromBase64(value))

function fakeCtx ({ files = [], env = { PATH: '/usr/bin:/bin' }, children = {}, net = {} } = {}) {
  const calls = []
  const ready = []
  const results = new Map()
  let next = 1
  let fd = 100
  const pipes = new Map()
  const ctx = {
    calls,
    pipes,
    env,
    cwd: () => '/home/app',
    memory: () => ctx.mem,
    mem: new WebAssembly.Memory({ initial: 1 }),
    fs: { exists: path => files.includes(path) },
    spawn: options => {
      calls.push(['spawn', options])
      const child = children[options.argv[0]]
      if (!child) throw Object.assign(new Error('not found'), { code: 'ENOENT' })
      const out = { pid: 42, stdin: fd++, stdout: fd++, stderr: fd++ }
      pipes.set(out.stdout, [...(child.stdout ?? [])].map(bytes))
      pipes.set(out.stderr, [...(child.stderr ?? [])].map(bytes))
      pipes.set('child', child)
      pipes.set('received', [])
      return out
    },
    wait: pid => {
      calls.push(['wait', pid])
      return { status: pipes.get('child').status ?? 0 }
    },
    syscall: request => {
      calls.push(['syscall', request])
      if (request.op === 'fd-close') return null
      if (request.op === 'net-request') {
        if (net.fail) throw Object.assign(new Error('down'), { code: net.fail })
        return { handle: 9, status: net.status ?? 200, headers: net.headers ?? [], ...(net.decoded === false ? { decoded: false } : {}) }
      }
      if (request.op === 'net-read') return net.chunks?.length ? bytes(net.chunks.shift()) : new Uint8Array(0)
      if (request.op === 'net-close') return null
      throw new Error(`unexpected syscall ${request.op}`)
    },
    async: {
      submit: request => {
        const id = next++
        calls.push(['submit', request.op, request.fd])
        const child = pipes.get('child')
        let value
        if (request.op === 'fd-read') {
          value = { value: pipes.get(request.fd).shift() ?? new Uint8Array(0) }
        } else if (request.op === 'fd-write') {
          const length = request.body.length
          pipes.get('received').push(new TextDecoder().decode(request.body.subarray(0, length)))
          value = { value: length }
        }
        results.set(id, value)
        ready.push(id)
        return id
      },
      wait: () => ready.shift(),
      take: id => results.get(id),
    },
  }
  return ctx
}

test('probe answers the magic the wasm import checks', () => {
  const { gh_host: host } = createImports(fakeCtx())
  assert.equal(host.probe(), PROBE)
})

test('envObject splits KEY=value and keeps equals in the value', () => {
  assert.deepEqual(envObject(['GH_TOKEN=abc', 'EMPTY=', 'A=b=c', 'nope']), { GH_TOKEN: 'abc', EMPTY: '', A: 'b=c' })
})

test('responseHeaders drops content-encoding after the kernel decoded the body', () => {
  assert.deepEqual(responseHeaders({ headers: [['Content-Encoding', 'gzip'], ['Content-Length', '4'], ['Content-Type', 'application/json']] }), [['Content-Type', 'application/json']])
  assert.deepEqual(responseHeaders({ decoded: false, headers: [['Content-Encoding', 'gzip']] }), [['Content-Encoding', 'gzip']])
})

test('which finds a PATH file and still names a slicc command that is not a file', () => {
  const host = createHost(fakeCtx({ files: ['/usr/bin/git'] }))
  assert.equal(host({ op: 'which', name: 'git' }), '/usr/bin/git')
  assert.equal(host({ op: 'which', name: 'gh' }), 'gh')
  assert.equal(host({ op: 'which', name: '/no/such' }), '')
})

test('run spawns a command, writes stdin and returns status and output', () => {
  const ctx = fakeCtx({ children: { git: { status: 0, stdout: ['rev-parse'], stderr: [''] } } })
  const host = createHost(ctx)
  const value = host({ op: 'run', argv: ['git', 'rev-parse'], env: ['GH_TOKEN=t'], dir: '/home/app', stdin: b64('in') })
  assert.equal(value.status, 0)
  assert.equal(text(value.stdout), 'rev-parse')
  assert.deepEqual(ctx.pipes.get('received'), ['in'])
  assert.equal(ctx.calls.find(([op]) => op === 'spawn')[1].env.GH_TOKEN, 't')
})

test('run reports a missing command', () => {
  const host = createHost(fakeCtx())
  assert.throws(() => host({ op: 'run', argv: ['git'] }), /executable file not found/)
})

test('http reads a body and closes the handle', () => {
  const ctx = fakeCtx({ net: { status: 200, headers: [['Content-Type', 'application/json']], chunks: ['{"login":"octocat"}'] } })
  const host = createHost(ctx)
  const head = host({ op: 'http', method: 'GET', url: 'http://127.0.0.1:9/user', headers: [], body: '' })
  assert.equal(head.status, 200)
  assert.equal(text(host({ op: 'http.read', handle: head.handle })), '{"login":"octocat"}')
  assert.equal(text(host({ op: 'http.read', handle: head.handle })), '')
  assert.equal(host({ op: 'http.close', handle: head.handle }), null)
})

test('createImports exchanges JSON through call and take', () => {
  const ctx = fakeCtx()
  const { gh_host: host } = createImports(ctx)
  const request = new TextEncoder().encode(JSON.stringify({ op: 'which', name: '' }))
  const memory = new Uint8Array(ctx.memory().buffer)
  memory.set(request, 64)
  const size = host.call(64, request.length)
  const taken = memory.slice(0, size)
  host.take(0)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(memory.slice(0, size))), { ok: true, value: '' })
  assert.equal(taken.length, size)
})

test('base64 round trip', () => {
  assert.equal(text(b64('gh')), 'gh')
  assert.equal(fromBase64('').length, 0)
})
