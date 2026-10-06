import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHost, createImports, envObject, fromBase64, PROBE, responseHeaders, toBase64 } from '../package/host/buf-host.mjs'

const bytes = text => new TextEncoder().encode(text)
const b64 = text => toBase64(bytes(text))
const text = value => new TextDecoder().decode(fromBase64(value))

function fakeCtx ({ files = [], env = { PATH: '/usr/bin:/bin' }, children = {}, net = {}, locks = new Map() } = {}) {
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
    fds: {
      tryLock: (fdn, exclusive) => {
        calls.push(['tryLock', fdn, exclusive])
        if (locks.has(fdn)) return 6
        locks.set(fdn, exclusive)
        return 0
      },
      unlock: fdn => {
        calls.push(['unlock', fdn])
        locks.delete(fdn)
      },
    },
    spawn: options => {
      calls.push(['spawn', options])
      const child = children[options.argv[0]]
      if (!child) throw Object.assign(new Error('not found'), { code: 'ENOENT' })
      if (child.throws) throw child.throws
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
          if (child.readError === request.fd - 101) value = { error: 'EIO' }
          else value = { value: pipes.get(request.fd).shift() ?? new Uint8Array(0) }
        } else if (request.op === 'fd-write') {
          if (child.writeError) value = { error: 'EPIPE' }
          else {
            const length = Math.min(request.body.length, child.writeChunk ?? request.body.length)
            pipes.get('received').push(new TextDecoder().decode(request.body.subarray(0, length)))
            value = { value: length }
          }
        }
        results.set(id, value)
        ready.push(id)
        return id
      },
      wait: () => {
        const id = ready.shift()
        return id === undefined ? 999 : id
      },
      take: id => {
        const value = results.get(id)
        results.delete(id)
        return value
      },
    },
  }
  return ctx
}

test('the imports answer the probe and exchange JSON through call and take', () => {
  const ctx = fakeCtx({ files: ['/usr/bin/git'] })
  const { buf_host: host } = createImports(ctx)
  assert.equal(host.probe(), PROBE)
  const memory = new Uint8Array(ctx.mem.buffer)
  const request = bytes(JSON.stringify({ op: 'which', name: 'git' }))
  memory.set(request, 16)
  const size = host.call(16, request.length)
  host.take(1024)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(memory.slice(1024, 1024 + size))), { ok: true, value: '/usr/bin/git' })
  memory.set(bytes('{oops'), 16)
  const bad = host.call(16, 5)
  host.take(1024)
  assert.equal(JSON.parse(new TextDecoder().decode(memory.slice(1024, 1024 + bad))).ok, false)
  const unknown = bytes(JSON.stringify({ op: 'nope' }))
  memory.set(unknown, 16)
  const failed = host.call(16, unknown.length)
  host.take(1024)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(memory.slice(1024, 1024 + failed))), { ok: false, error: 'unknown buf_host operation nope' })
})

test('which searches PATH, takes paths as they are and answers empty for unknown names', () => {
  const handle = createHost(fakeCtx({ files: ['/bin/protoc-gen-go', '/home/app/tools/gen'] }))
  assert.equal(handle({ op: 'which', name: 'protoc-gen-go' }), '/bin/protoc-gen-go')
  assert.equal(handle({ op: 'which', name: 'tools/gen' }), '')
  assert.equal(handle({ op: 'which', name: '/home/app/tools/gen' }), '/home/app/tools/gen')
  assert.equal(handle({ op: 'which', name: '/missing' }), '')
  assert.equal(handle({ op: 'which', name: 'missing' }), '')
  assert.equal(handle({ op: 'which', name: '' }), '')
  const noPath = createHost(fakeCtx({ files: ['/usr/bin/git'], env: {} }))
  assert.equal(noPath({ op: 'which', name: 'git' }), '/usr/bin/git')
})

test('run feeds stdin, collects stdout and stderr and reports the exit status', () => {
  const ctx = fakeCtx({ children: { 'protoc-gen-go': { stdout: ['hel', 'lo'], stderr: ['warn'], status: 3, writeChunk: 4 } } })
  const result = createHost(ctx)({ op: 'run', argv: ['protoc-gen-go', '--x'], env: ['A=1', 'B=x=y', 'junk'], dir: '/work', stdin: b64('request') })
  assert.equal(result.status, 3)
  assert.equal(text(result.stdout), 'hello')
  assert.equal(text(result.stderr), 'warn')
  assert.deepEqual(ctx.pipes.get('received'), ['requ', 'est'])
  const [, options] = ctx.calls.find(([kind]) => kind === 'spawn')
  assert.deepEqual(options, { argv: ['protoc-gen-go', '--x'], env: { A: '1', B: 'x=y' }, cwd: '/work', stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  assert.ok(ctx.calls.some(([kind, request]) => kind === 'syscall' && request.op === 'fd-close' && request.fd === 100))
})

test('run without stdin closes it at once and runs in the current directory', () => {
  const ctx = fakeCtx({ children: { git: { stdout: ['ok'] } } })
  const result = createHost(ctx)({ op: 'run', argv: ['git', 'status'] })
  assert.equal(result.status, 0)
  assert.equal(text(result.stdout), 'ok')
  assert.equal(text(result.stderr), '')
  assert.equal(ctx.calls.find(([kind]) => kind === 'spawn')[1].cwd, '/home/app')
  assert.ok(!ctx.calls.some(([kind, op]) => kind === 'submit' && op === 'fd-write'))
})

test('run stops writing when stdin breaks and stops reading a stream that fails', () => {
  const ctx = fakeCtx({ children: { cat: { stdout: ['partial'], writeError: true, readError: 0 } } })
  const result = createHost(ctx)({ op: 'run', argv: ['cat'], stdin: b64('input') })
  assert.equal(result.status, 0)
  assert.equal(text(result.stdout), '')
  assert.ok(ctx.calls.some(([kind, request]) => kind === 'syscall' && request.op === 'fd-close' && request.fd === 101))
})

test('run says why a command could not start', () => {
  const host = createHost(fakeCtx({ children: { broken: { throws: Object.assign(new Error('nope'), { code: 'EACCES' }) }, odd: { throws: new Error('strange') } } }))
  assert.throws(() => host({ op: 'run', argv: ['protoc-gen-x'] }), { message: 'exec: "protoc-gen-x": executable file not found in $PATH' })
  assert.throws(() => host({ op: 'run', argv: ['broken'] }), { message: 'exec: "broken": EACCES' })
  assert.throws(() => host({ op: 'run', argv: ['odd'] }), { message: 'exec: "odd": strange' })
})

test('http sends the request through net-request and streams the body', () => {
  const ctx = fakeCtx({ net: { status: 201, headers: [['Content-Type', 'application/json'], ['Content-Encoding', 'gzip'], ['Content-Length', '10']], chunks: ['{"a"', ':1}'] } })
  const handle = createHost(ctx)
  const head = handle({ op: 'http', method: 'POST', url: 'https://buf.build/api', headers: [['x', 'y']], body: b64('payload') })
  assert.deepEqual(head, { handle: 9, status: 201, headers: [['Content-Type', 'application/json']] })
  const [, request] = ctx.calls.find(([kind, r]) => kind === 'syscall' && r.op === 'net-request')
  assert.equal(new TextDecoder().decode(request.body), 'payload')
  assert.deepEqual(request.headers, [['x', 'y']])
  assert.equal(text(handle({ op: 'http.read', handle: 9 })), '{"a"')
  assert.equal(text(handle({ op: 'http.read', handle: 9 })), ':1}')
  assert.equal(handle({ op: 'http.read', handle: 9 }), '')
  assert.equal(handle({ op: 'http.close', handle: 9 }), null)
  const get = createHost(fakeCtx())({ op: 'http', url: 'http://example.invalid/x' })
  assert.equal(get.status, 200)
})

test('http rejects bad URLs and says which host it could not reach', () => {
  const handle = createHost(fakeCtx({ net: { fail: 'ECONNREFUSED' } }))
  assert.throws(() => handle({ op: 'http', url: 'not a url' }), { message: 'invalid URL not a url' })
  assert.throws(() => handle({ op: 'http', url: 'ftp://example.invalid/' }), { message: 'unsupported protocol ftp:' })
  assert.throws(() => handle({ op: 'http', url: 'https://buf.build/x' }), { message: 'could not reach buf.build (ECONNREFUSED)' })
  const plain = createHost(fakeCtx({ net: { fail: undefined } }))
  assert.equal(plain({ op: 'http', url: 'https://buf.build/x', headers: undefined }).status, 200)
})

test('lock and unlock use the kernel file locks', () => {
  const ctx = fakeCtx()
  const handle = createHost(ctx)
  assert.equal(handle({ op: 'lock', fd: 5, exclusive: true }), true)
  assert.equal(handle({ op: 'lock', fd: 5 }), false)
  assert.equal(handle({ op: 'unlock', fd: 5 }), null)
  assert.equal(handle({ op: 'lock', fd: 5, exclusive: false }), true)
  assert.deepEqual(ctx.calls, [['tryLock', 5, true], ['tryLock', 5, true], ['unlock', 5], ['tryLock', 5, false]])
})

test('response headers drop the encoding of a body the transport decoded', () => {
  assert.deepEqual(responseHeaders({ headers: [['Content-Encoding', 'br'], ['ETag', '1']], decoded: false }), [['Content-Encoding', 'br'], ['ETag', '1']])
  assert.deepEqual(responseHeaders({ headers: [['content-encoding', 'zstd']] }), [['content-encoding', 'zstd']])
  assert.deepEqual(responseHeaders({}), [])
})

test('base64 and environment helpers work without the newer built-ins', () => {
  assert.deepEqual(envObject(['A=1', '=x', 'B=']), { A: '1', B: '' })
  assert.deepEqual(envObject(undefined), {})
  assert.deepEqual(fromBase64(''), new Uint8Array(0))
  assert.deepEqual(fromBase64(undefined), new Uint8Array(0))
  const fromNative = Uint8Array.fromBase64
  const toNative = Uint8Array.prototype.toBase64
  try {
    delete Uint8Array.fromBase64
    delete Uint8Array.prototype.toBase64
    assert.equal(toBase64(bytes('hello')), 'aGVsbG8=')
    assert.equal(new TextDecoder().decode(fromBase64('aGVsbG8=')), 'hello')
  } finally {
    if (fromNative) Uint8Array.fromBase64 = fromNative
    if (toNative) Object.defineProperty(Uint8Array.prototype, 'toBase64', { value: toNative, configurable: true, writable: true })
  }
})
