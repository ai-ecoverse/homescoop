import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAsyncHost, createAsyncImports, createHost, createImports, envObject, fromBase64, PROBE, responseHeaders, toBase64 } from '../package/host/gh-host.mjs'

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

test('run inherits process stdin instead of writing the pipe', () => {
  const ctx = fakeCtx({ children: { git: { status: 0, stdout: [''], stderr: [''] } } })
  const host = createHost(ctx)
  const value = host({ op: 'run', argv: ['git', 'status'], inherit: true, stdin: b64('kept') })
  assert.equal(value.status, 0)
  assert.equal(ctx.calls.find(([op]) => op === 'spawn')[1].stdin, 'inherit')
  assert.equal(ctx.calls.some((call) => call[0] === 'submit' && call[1] === 'fd-write'), false)
  assert.deepEqual(ctx.pipes.get('received') ?? [], [])
})

test('chmod sets the mode on the kernel file', () => {
  const modes = []
  const ctx = fakeCtx()
  ctx.fs.chmod = (path, mode) => modes.push([path, mode])
  const host = createHost(ctx)
  assert.equal(host({ op: 'chmod', path: '/home/gh/.config/gh/hosts.yml', mode: 0o600 }), null)
  assert.deepEqual(modes, [['/home/gh/.config/gh/hosts.yml', 0o600]])
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
  const wrap = table => Object.fromEntries(Object.entries(table).map(([name, fn]) => [name, typeof fn === 'function' ? later(fn) : fn]))
  return {
    ...ctx,
    cwd: later(ctx.cwd),
    fs: wrap(ctx.fs),
    spawn: later(ctx.spawn),
    wait: later(ctx.wait),
    syscall: later(ctx.syscall),
    async: wrap(ctx.async),
  }
}

test('createAsyncHost answers the same operations over a ctx of promises', async () => {
  const host = createAsyncHost(asyncCtx(fakeCtx({ files: ['/usr/bin/git'], children: { git: { status: 3, stdout: ['out'], stderr: ['err'] } } })))
  assert.equal(await host({ op: 'which', name: 'git' }), '/usr/bin/git')
  assert.equal(await host({ op: 'which', name: '/usr/bin/git' }), '/usr/bin/git')
  const ran = await host({ op: 'run', argv: ['git', 'status'], stdin: b64('in') })
  assert.equal(ran.status, 3)
  assert.equal(text(ran.stdout), 'out')
  assert.equal(text(ran.stderr), 'err')
  await assert.rejects(host({ op: 'run', argv: ['nope'] }), /executable file not found/)
  await assert.rejects(host({ op: 'nope' }), /unknown gh_host operation nope/)
})

test('createAsyncHost reads an HTTP body and reports an unreachable host', async () => {
  const host = createAsyncHost(asyncCtx(fakeCtx({ net: { chunks: ['{"full_name":"cli/cli"}'] } })))
  const head = await host({ op: 'http', method: 'GET', url: 'https://api.github.com/repos/cli/cli', headers: [['Authorization', 'token placeholder']] })
  assert.equal(head.status, 200)
  assert.equal(text(await host({ op: 'http.read', handle: head.handle })), '{"full_name":"cli/cli"}')
  assert.equal(await host({ op: 'http.close', handle: head.handle }), null)
  const down = createAsyncHost(asyncCtx(fakeCtx({ net: { fail: 'ENETUNREACH' } })))
  await assert.rejects(down({ op: 'http', url: 'https://api.github.com/' }), /could not reach api\.github\.com \(ENETUNREACH\)/)
})

test('createAsyncImports gives gh_host.call as an async function, so the kernel suspends gh.wasm', async () => {
  const ctx = asyncCtx(fakeCtx())
  const { gh_host: host } = createAsyncImports(ctx)
  assert.equal(host.call.constructor.name, 'AsyncFunction')
  assert.equal(host.probe(), PROBE)
  const request = new TextEncoder().encode(JSON.stringify({ op: 'which', name: '' }))
  const memory = new Uint8Array(ctx.memory().buffer)
  memory.set(request, 64)
  const size = await host.call(64, request.length)
  host.take(0)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(memory.slice(0, size))), { ok: true, value: '' })
  const bad = new TextEncoder().encode('{"op":"nope"}')
  memory.set(bad, 64)
  const failed = await host.call(64, bad.length)
  host.take(0)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(memory.slice(0, failed))), { ok: false, error: 'unknown gh_host operation nope' })
})
