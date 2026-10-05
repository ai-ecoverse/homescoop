import assert from 'node:assert/strict'
import { test } from 'node:test'

import { GIT_MISSING, GIT_UNSUPPORTED, MAX_UPLOAD, childEnv, waitStatus, PUBLISH_TOO_LARGE, PUBLISH_UNSUPPORTED, createImports, envelope, errno, errorNumber, headerPairs, responseHeaders } from '../package/host/pnpm-host.mjs'

function fakeContext () {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true })
  const entries = new Map([['/', { kind: 'dir', mode: 0o755 }]])
  const fds = new Map()
  const opened = []
  const submitted = []
  const results = new Map()
  const cancelled = []
  const syscalls = []
  let nextFd = 10
  let nextId = 1
  const error = code => Object.assign(new Error(code), { code })
  const fs = {
    lstat (path) {
      const entry = entries.get(path)
      if (!entry) throw error('ENOENT')
      return { isFile: entry.kind === 'file', isDirectory: entry.kind === 'dir', isSymbolicLink: entry.kind === 'symlink', size: 0, ...(entry.mode === undefined ? {} : { mode: entry.mode }) }
    },
    stat (path) {
      if (fs.files.has(path)) return { isFile: true, isDirectory: false, size: fs.files.get(path).length, mode: 0o644 }
      return fs.lstat(path)
    },
    exists: path => entries.has(path),
    mkdir (path) {
      if (entries.has(path)) throw error('EEXIST')
      if (path === '/racy') {
        entries.set(path, { kind: 'dir' })
        throw error('EEXIST')
      }
      entries.set(path, { kind: 'dir' })
    },
    chmod (path, mode) { entries.get(path).mode = mode },
    files: new Map(),
    writeFile (path, bytes) { fs.files.set(path, bytes) },
    readFile (path) {
      if (!fs.files.has(path)) throw error('ENOENT')
      return fs.files.get(path)
    },
    unlink (path) {
      if (!fs.files.delete(path)) throw error('ENOENT')
    },
    readdir (path) {
      const prefix = `${path}/`
      return [...new Set([...fs.files.keys(), ...entries.keys()].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length).split('/')[0]))]
    },
    rmdir (path) {
      if (fs.readdir(path).length) throw error('ENOTEMPTY')
      entries.delete(path)
    },
  }
  return {
    entries,
    opened,
    submitted,
    results,
    cancelled,
    syscalls,
    memory: () => memory,
    fs,
    fds: {
      open (path, options) {
        opened.push({ path, options })
        if (options.exclusive && entries.has(path)) throw error('EEXIST')
        if (!options.create && !entries.has(path)) throw error('ENOENT')
        if (!entries.has(path)) entries.set(path, { kind: 'file', mode: options.mode ?? 0o644 })
        const fd = nextFd++
        fds.set(fd, path)
        return fd
      },
      fstat (fd) {
        if (!fds.has(fd)) throw error('EBADF')
        const entry = entries.get(fds.get(fd))
        return { kind: entry.kind, mode: entry.mode | (entry.kind === 'dir' ? 0o40000 : 0o100000), uid: entry.uid ?? 1000, gid: 1000, size: 0 }
      },
      fchmod (fd, mode) { entries.get(fds.get(fd)).mode = mode },
      tryLock (fd, exclusive) {
        if (fd === 99) throw error('EBADF')
        return exclusive && fd === 13 ? errno.EWOULDBLOCK : 0
      },
    },
    traits: undefined,
    sent: [],
    reply: { handle: 5, status: 201, statusText: 'Created', url: 'https://registry.example/x', headers: [['content-type', 'application/json']] },
    syscall (request) {
      if (request.op === 'net-traits') {
        if (this.traits === undefined) throw error('ENOSYS')
        return this.traits
      }
      if (request.op === 'net-request') {
        this.sent.push(request)
        if (this.reply instanceof Error) throw this.reply
        return this.reply
      }
      syscalls.push(request)
      return 0
    },
    heap: 4096,
    instance () {
      return { exports: {
        malloc: size => {
          if (size > 1 << 20) return 0
          const at = this.heap
          this.heap += size + 8
          return at
        },
        free: () => {},
      } }
    },
    async: {
      submit (request) {
        const id = nextId++
        submitted.push({ id, request })
        return id
      },
      resolve (value) {
        const id = nextId++
        results.set(id, value)
        return id
      },
      hold () { return nextId++ },
      take (id) {
        if (!results.has(id)) return undefined
        const value = results.get(id)
        results.delete(id)
        if (value instanceof Error) throw value
        if (typeof value === 'string' && value.startsWith('E')) return { error: value }
        return { value }
      },
      cancel (id) { cancelled.push(id) },
      wait: () => 7,
    },
  }
}

function put (ctx, offset, text) {
  const bytes = new TextEncoder().encode(text)
  new Uint8Array(ctx.memory().buffer, offset, bytes.length).set(bytes)
  return [offset, bytes.length]
}

function u32 (ctx, offset) {
  return new DataView(ctx.memory().buffer).getUint32(offset, true)
}

function response (ctx, host, id) {
  const length = host.response_len(id)
  assert.ok(length > 0)
  assert.equal(host.response_read(id, 8192, length), length)
  return JSON.parse(new TextDecoder().decode(new Uint8Array(ctx.memory().buffer, 8192, length).slice()))
}

test('pnpm_atomic waits report not-equal and timeout', () => {
  const ctx = fakeContext()
  const { pnpm_atomic: atomic } = createImports(ctx)
  new Int32Array(ctx.memory().buffer)[4] = 5
  assert.equal(atomic.wait32(16, 4, 0n, 0), 1)
  assert.equal(atomic.wait32(16, 5, 1000n, 0), 2)
  assert.equal(atomic.wait64(16, 0n, 1000n, 8), 2)
  assert.throws(() => atomic.wait32(18, 0, 0n, 0), WebAssembly.RuntimeError)
})

test('pnpm_fs create_new opens exclusively with the mode and reports EEXIST', () => {
  const ctx = fakeContext()
  const { pnpm_fs: fs } = createImports(ctx)
  const [pointer, length] = put(ctx, 64, '/store/index.db')
  assert.equal(fs.create_new(pointer, length, 0o600, 4096), 0)
  assert.equal(u32(ctx, 4096), 10)
  assert.deepEqual(ctx.opened[0], { path: '/store/index.db', options: { read: true, write: true, create: true, exclusive: true, mode: 0o600, nofollow: true } })
  assert.equal(fs.create_new(pointer, length, 0o600, 4096), errno.EEXIST)
  assert.equal(fs.create_new(pointer, length, 0o10000, 4096), errno.EINVAL)
  const [relative, relativeLength] = put(ctx, 256, 'relative')
  assert.equal(fs.create_new(relative, relativeLength, 0o600, 4096), errno.EINVAL)
})

test('pnpm_fs open_nofollow, open_lock, try_lock and modes', () => {
  const ctx = fakeContext()
  const { pnpm_fs: fs } = createImports(ctx)
  ctx.entries.set('/lock', { kind: 'file', mode: 0o644 })
  const [pointer, length] = put(ctx, 64, '/lock')
  assert.equal(fs.open_nofollow(pointer, length, 4096), 0)
  assert.equal(fs.open_lock(pointer, length, 4100), 0)
  assert.deepEqual(ctx.opened[1].options, { read: true, write: true, nofollow: true })
  assert.equal(fs.try_lock(11, 1), 0)
  assert.equal(fs.try_lock(13, 1), errno.EWOULDBLOCK)
  assert.equal(fs.try_lock(99, 0), errno.EBADF)
  assert.equal(fs.fchmod(10, 0o100600), 0)
  assert.equal(ctx.entries.get('/lock').mode, 0o600)
  assert.equal(fs.fmode(10, 4104), 0)
  assert.equal(u32(ctx, 4104), 0o100600)
  assert.equal(fs.lmode(pointer, length, 4108), 0)
  assert.equal(u32(ctx, 4108), 0o100600)
  assert.equal(fs.fmode(99, 4104), errno.EBADF)
  assert.equal(fs.check_owner(10), 0)
  ctx.entries.get('/lock').uid = 0
  assert.equal(fs.check_owner(10), errno.EACCES)
  ctx.entries.set('/plain', { kind: 'file' })
  ctx.entries.set('/dirmode', { kind: 'dir' })
  ctx.entries.set('/sym', { kind: 'symlink' })
  for (const [path, mode] of [['/plain', 0o100644], ['/dirmode', 0o40755], ['/sym', 0o120777]]) {
    assert.equal(fs.lmode(...put(ctx, 512, path), 4112), 0)
    assert.equal(u32(ctx, 4112), mode)
  }
  assert.equal(fs.umask(), 0o022)
  assert.equal(fs.uid(), 1000)
  assert.equal(fs.grant_directory_mode_beneath(), errno.ENOTSUP)
  assert.equal(fs.sqlite_register(pointer, length, 1), 0)
})

test('pnpm_fs path_access_executable checks the exec bits', () => {
  const ctx = fakeContext()
  const { pnpm_fs: fs } = createImports(ctx)
  ctx.entries.set('/bin/tool', { kind: 'file', mode: 0o755 })
  ctx.entries.set('/data', { kind: 'file', mode: 0o644 })
  const [tool, toolLength] = put(ctx, 64, '/bin/tool')
  const [data, dataLength] = put(ctx, 128, '/data')
  const [missing, missingLength] = put(ctx, 192, '/missing')
  assert.equal(fs.path_access_executable(tool, toolLength), 0)
  assert.equal(fs.path_access_executable(data, dataLength), errno.EACCES)
  assert.equal(fs.path_access_executable(missing, missingLength), errno.ENOENT)
})

test('pnpm_fs secure_directory creates a private directory once', () => {
  const ctx = fakeContext()
  const { pnpm_fs: fs } = createImports(ctx)
  const [pointer, length] = put(ctx, 64, '/tmp/pnpm-locks-1000')
  assert.equal(fs.secure_directory(pointer, length), 0)
  assert.equal(ctx.entries.get('/tmp').kind, 'dir')
  assert.equal(ctx.entries.get('/tmp/pnpm-locks-1000').mode, 0o700)
  ctx.entries.get('/tmp/pnpm-locks-1000').mode = 0o755
  assert.equal(fs.secure_directory(pointer, length), 0)
  assert.equal(ctx.entries.get('/tmp/pnpm-locks-1000').mode, 0o700)
  ctx.entries.set('/tmp/file', { kind: 'file', mode: 0o644 })
  const [file, fileLength] = put(ctx, 128, '/tmp/file')
  assert.equal(fs.secure_directory(file, fileLength), errno.ENOTDIR)
  assert.equal(fs.secure_directory(...put(ctx, 192, '/racy')), 0)
  const real = ctx.fs.mkdir
  ctx.fs.mkdir = () => { throw Object.assign(new Error('EROFS'), { code: 'EROFS' }) }
  assert.equal(fs.secure_directory(...put(ctx, 256, '/ro/dir')), errno.EIO)
  ctx.fs.mkdir = real
})

test('pnpm_fs open_directory_nofollow_beneath walks below the template', () => {
  const ctx = fakeContext()
  const { pnpm_fs: fs } = createImports(ctx)
  ctx.entries.set('/p', { kind: 'dir', mode: 0o755 })
  ctx.entries.set('/p/a', { kind: 'dir', mode: 0o755 })
  ctx.entries.set('/p/a/b', { kind: 'dir', mode: 0o755 })
  ctx.entries.set('/p/link', { kind: 'symlink', mode: 0o777 })
  ctx.entries.set('/p/file', { kind: 'file', mode: 0o644 })
  const [template, templateLength] = put(ctx, 64, '/p/')
  const [inside, insideLength] = put(ctx, 128, '/p/a/b')
  assert.equal(fs.open_directory_nofollow_beneath(inside, insideLength, template, templateLength, 4096), 0)
  assert.deepEqual(ctx.opened.at(-1), { path: '/p/a/b', options: { read: true, directory: true, nofollow: true } })
  const [link, linkLength] = put(ctx, 192, '/p/link/x')
  assert.equal(fs.open_directory_nofollow_beneath(link, linkLength, template, templateLength, 4096), errno.ELOOP)
  const [file, fileLength] = put(ctx, 256, '/p/file')
  assert.equal(fs.open_directory_nofollow_beneath(file, fileLength, template, templateLength, 4096), errno.ENOTDIR)
  const [outside, outsideLength] = put(ctx, 320, '/q/a')
  assert.equal(fs.open_directory_nofollow_beneath(outside, outsideLength, template, templateLength, 4096), errno.EINVAL)
  const [dots, dotsLength] = put(ctx, 384, '/p/../etc')
  assert.equal(fs.open_directory_nofollow_beneath(dots, dotsLength, template, templateLength, 4096), errno.EINVAL)
})

test('pnpm_host network.request submits net-request and answers with the head', () => {
  const ctx = fakeContext()
  const { pnpm_host: host } = createImports(ctx)
  const request = { operation: 'network.request', url: 'https://registry.npmjs.org/is-odd', method: 'GET', headers: { accept: 'application/json' }, body: [1, 2], timeoutMs: 60000 }
  const [pointer, length] = put(ctx, 64, JSON.stringify(request))
  const id = host.operation_start(pointer, length)
  assert.equal(id, 1)
  const submitted = ctx.submitted[0].request
  assert.equal(submitted.op, 'net-request')
  assert.deepEqual(submitted.headers, [['accept', 'application/json']])
  assert.deepEqual([...submitted.body], [1, 2])
  assert.equal(host.response_len(id), -1)
  ctx.results.set(id, { handle: 3, status: 200, statusText: 'OK', url: request.url, headers: [['content-type', 'application/json'], ['content-encoding', 'gzip'], ['content-length', '10']] })
  assert.deepEqual(response(ctx, host, id), { ok: true, value: { handle: 3, status: 200, headers: [['content-type', 'application/json']], url: request.url } })
  assert.equal(host.response_read(id, 8192, 100), -2)
})

test('pnpm_host stream.read, resource.close and transport errors', () => {
  const ctx = fakeContext()
  const { pnpm_host: host } = createImports(ctx)
  const [pointer, length] = put(ctx, 64, JSON.stringify({ operation: 'stream.read', handle: 3, maxBytes: 1 << 20 }))
  const read = host.operation_start(pointer, length)
  assert.deepEqual(ctx.submitted[0].request, { op: 'net-read', handle: 3, max: 65536 })
  ctx.results.set(read, new Uint8Array([104, 105]))
  assert.deepEqual(response(ctx, host, read), { ok: true, value: { bytes: [104, 105], done: false } })
  const [closePointer, closeLength] = put(ctx, 64, JSON.stringify({ operation: 'resource.close', handle: 3 }))
  const close = host.operation_start(closePointer, closeLength)
  assert.deepEqual(ctx.submitted[1].request, { op: 'net-close', handle: 3 })
  ctx.results.set(close, 'ECONNREFUSED')
  assert.deepEqual(response(ctx, host, close), { ok: false, error: { message: 'ECONNREFUSED', code: 'ECONNREFUSED' } })
  const thrown = host.operation_start(pointer, length)
  ctx.results.set(thrown, Object.assign(new Error('bridge down'), { code: 'EIO' }))
  assert.deepEqual(response(ctx, host, thrown), { ok: false, error: { message: 'bridge down', code: 'EIO' } })
})

test('pnpm_host answers local and unsupported operations', () => {
  const ctx = fakeContext()
  const { pnpm_host: host } = createImports(ctx)
  const start = request => host.operation_start(...put(ctx, 64, JSON.stringify(request)))
  assert.deepEqual(response(ctx, host, start({ operation: 'terminal.status' })), { ok: true, value: { stdin: false, stdout: false, stderr: false } })
  const spawn = response(ctx, host, start({ operation: 'process.spawn', command: 'node' }))
  assert.equal(spawn.ok, false)
  assert.match(spawn.error.message, /--ignore-scripts/)
  assert.match(response(ctx, host, start({ operation: 'bogus' })).error.message, /Unknown WASM host operation/)
  assert.match(response(ctx, host, start({ operation: 'network.request', url: 'not a url' })).error.message, /Invalid HTTP request URL/)
  assert.match(response(ctx, host, start({ operation: 'network.request', url: 'file:///etc/passwd' })).error.message, /Unsupported HTTP protocol/)
  assert.match(response(ctx, host, start({ operation: 'process.spawn', program: '/usr/bin/git', args: ['ls-remote'] })).error.message, /git could not start/)
  assert.equal(response(ctx, host, start({ operation: 'shell.spawn', program: 'ssh' })).error.message, GIT_UNSUPPORTED)
  assert.equal(response(ctx, host, start({ operation: 'process.spawn' })).error.code, 'ENOTSUP')
  const signal = start({ operation: 'signal.next' })
  assert.equal(host.response_len(signal), -1)
  assert.equal(host.operation_start(...put(ctx, 64, '{not json')), -2)
  assert.equal(host.operation_start(64, 2 * 1024 * 1024), -2)
  assert.equal(host.wait_completion(), 7)
})

test('pnpm_host cancel closes an unread response handle and resource_close is synchronous', () => {
  const ctx = fakeContext()
  const { pnpm_host: host } = createImports(ctx)
  const id = host.operation_start(...put(ctx, 64, JSON.stringify({ operation: 'network.request', url: 'https://registry.npmjs.org/a' })))
  ctx.results.set(id, { handle: 9, status: 200, url: 'https://registry.npmjs.org/a', headers: [] })
  assert.ok(host.response_len(id) > 0)
  host.operation_cancel(id)
  assert.deepEqual(ctx.syscalls, [{ op: 'net-close', handle: 9 }])
  assert.deepEqual(ctx.cancelled, [id])
  assert.equal(host.resource_close(4), 0)
  ctx.syscall = () => { throw new Error('gone') }
  assert.equal(host.resource_close(4), -1)
  host.operation_cancel(12345)
})

test('helpers: errno mapping, header pairs, envelopes and oversized responses', () => {
  assert.equal(errorNumber(Object.assign(new Error('x'), { code: 'ENOENT' })), errno.ENOENT)
  assert.equal(errorNumber({ errno: 63 }), 63)
  assert.equal(errorNumber(new RangeError('x')), errno.EFAULT)
  assert.equal(errorNumber(new Error('x')), errno.EIO)
  assert.deepEqual(headerPairs(undefined), [])
  assert.deepEqual(headerPairs([['a', 1]]), [['a', '1']])
  assert.deepEqual(responseHeaders({ headers: [['content-encoding', 'zstd']] }), [['content-encoding', 'zstd']])
  assert.deepEqual(responseHeaders({ decoded: false, headers: [['content-encoding', 'gzip']] }), [['content-encoding', 'gzip']])
  assert.deepEqual(envelope({ errno: 44, message: 'nope', code: 'ENOENT' }), { ok: false, error: { message: 'nope', code: 'ENOENT' } })
  assert.deepEqual(envelope({ errno: 44 }), { ok: false, error: { message: 'errno 44', code: null } })
  assert.deepEqual(envelope(0), { ok: true, value: 0 })
  assert.deepEqual(envelope(undefined), { ok: true, value: null })
  const ctx = fakeContext()
  const { pnpm_host: host } = createImports(ctx)
  const id = host.operation_start(...put(ctx, 64, JSON.stringify({ operation: 'stream.read', handle: 1 })))
  ctx.results.set(id, new Uint8Array(300 * 1024).fill(255))
  const length = host.response_len(id)
  assert.ok(length < 1024 * 1024)
  assert.equal(host.response_read(id, 8192, length), length)
  assert.match(new TextDecoder().decode(new Uint8Array(ctx.memory().buffer, 8192, length).slice()), /transfer limit/)
})

test('pnpm_host refuses publishing on a CORS transport', () => {
  const ctx = fakeContext()
  ctx.traits = { crossOrigin: 'cors' }
  const { pnpm_host: host } = createImports(ctx)
  const start = request => host.operation_start(...put(ctx, 64, JSON.stringify(request)))
  const head = response(ctx, host, start({ operation: 'network.request', url: 'https://registry.npmjs.org/x', method: 'PUT', body: [1] }))
  assert.equal(head.value.status, 405)
  const body = response(ctx, host, start({ operation: 'stream.read', handle: head.value.handle }))
  assert.deepEqual(JSON.parse(new TextDecoder().decode(Uint8Array.from(body.value.bytes))), { error: PUBLISH_UNSUPPORTED })
  assert.deepEqual(response(ctx, host, start({ operation: 'stream.read', handle: head.value.handle })), { ok: true, value: { bytes: [], done: true } })
  assert.deepEqual(response(ctx, host, start({ operation: 'resource.close', handle: head.value.handle })), { ok: true, value: null })
  assert.equal(ctx.sent.length, 0)
  const unread = start({ operation: 'network.request', url: 'https://registry.npmjs.org/y', method: 'DELETE' })
  assert.ok(host.response_len(unread) > 0)
  host.operation_cancel(unread)
  const closed = response(ctx, host, start({ operation: 'network.request', url: 'https://registry.npmjs.org/z', method: 'PUT' }))
  assert.equal(host.resource_close(closed.value.handle), 0)
  assert.equal(ctx.fs.files.size, 0)
})

test('pnpm_host sends an inline publish and explains unreachable registries', () => {
  const ctx = fakeContext()
  ctx.traits = { crossOrigin: 'any' }
  const { pnpm_host: host } = createImports(ctx)
  const start = request => host.operation_start(...put(ctx, 64, JSON.stringify(request)))
  const ok = response(ctx, host, start({ operation: 'network.request', url: 'https://registry.example/x', method: 'put', headers: { authorization: 'Bearer SECRET' }, body: [1, 2, 3] }))
  assert.deepEqual(ok, { ok: true, value: { handle: 5, status: 201, headers: [['content-type', 'application/json']], url: 'https://registry.example/x' } })
  assert.deepEqual([...ctx.sent[0].body], [1, 2, 3])
  assert.equal(ctx.sent[0].method, 'PUT')
  assert.deepEqual(ctx.sent[0].headers, [['authorization', 'Bearer SECRET']])
  ctx.reply = Object.assign(new Error('down'), { code: 'ECONNREFUSED' })
  const down = response(ctx, host, start({ operation: 'network.request', url: 'https://registry.example/x', method: 'PUT', headers: { authorization: 'Bearer SECRET' } }))
  const text = new TextDecoder().decode(Uint8Array.from(response(ctx, host, start({ operation: 'stream.read', handle: down.value.handle })).value.bytes))
  assert.equal(down.value.status, 502)
  assert.deepEqual(JSON.parse(text), { error: 'could not reach registry.example (ECONNREFUSED)' })
  assert.ok(!text.includes('SECRET'))
  ctx.reply = new Error('no code')
  const odd = response(ctx, host, start({ operation: 'network.request', url: 'https://registry.example/x', method: 'PUT' }))
  assert.equal(odd.value.status, 502)
  const big = response(ctx, host, start({ operation: 'network.request', url: 'https://registry.example/x', method: 'PUT', body: Array.from({ length: 4 }) }))
  assert.equal(big.ok, true)
  for (const name of [...ctx.fs.files.keys()]) assert.ok(!new TextDecoder().decode(ctx.fs.files.get(name)).includes('SECRET'))
})

test('pnpm_host hints at the CORS-free transport when traits are unknown', () => {
  const ctx = fakeContext()
  const { pnpm_host: host } = createImports(ctx)
  const start = request => host.operation_start(...put(ctx, 64, JSON.stringify(request)))
  ctx.reply = Object.assign(new Error('blocked'), { code: 'ECONNREFUSED' })
  const head = response(ctx, host, start({ operation: 'network.request', url: 'https://registry.npmjs.org/x', method: 'PUT' }))
  const text = new TextDecoder().decode(Uint8Array.from(response(ctx, host, start({ operation: 'stream.read', handle: head.value.handle })).value.bytes))
  assert.equal(JSON.parse(text).error, `could not reach registry.npmjs.org (ECONNREFUSED); on a plain page, ${PUBLISH_UNSUPPORTED}`)
})

test('pnpm_host streams an upload and sends it after upload.end, keeping headers out of files', () => {
  const ctx = fakeContext()
  ctx.traits = { crossOrigin: 'any' }
  const { pnpm_host: host } = createImports(ctx)
  const start = request => host.operation_start(...put(ctx, 64, JSON.stringify(request)))
  const upload = response(ctx, host, start({ operation: 'upload.create' }))
  const id = start({ operation: 'network.request', url: 'https://registry.example/x', method: 'PUT', headers: [['authorization', 'Bearer SECRET']], bodyHandle: upload.value.handle })
  assert.equal(host.response_len(id), -1)
  assert.deepEqual(response(ctx, host, start({ operation: 'upload.write', handle: upload.value.handle, bytes: [1, 2] })), { ok: true, value: null })
  assert.deepEqual(response(ctx, host, start({ operation: 'upload.write', handle: upload.value.handle, bytes: [3] })), { ok: true, value: null })
  for (const name of [...ctx.fs.files.keys()]) assert.ok(!new TextDecoder().decode(ctx.fs.files.get(name)).includes('SECRET'))
  assert.match(response(ctx, host, start({ operation: 'upload.write', handle: upload.value.handle, bytes: 'nope' })).error.message, /bytes/)
  assert.deepEqual(response(ctx, host, start({ operation: 'upload.end', handle: upload.value.handle })), { ok: true, value: null })
  assert.deepEqual([...ctx.sent[0].body], [1, 2, 3])
  assert.deepEqual(ctx.sent[0].headers, [['authorization', 'Bearer SECRET']])
  assert.equal(response(ctx, host, id).value.status, 201)
  assert.deepEqual(response(ctx, host, start({ operation: 'resource.close', handle: upload.value.handle })), { ok: true, value: null })
  assert.deepEqual([...ctx.fs.files.keys()], [])
  const second = response(ctx, host, start({ operation: 'upload.create' }))
  const late = start({ operation: 'network.request', url: 'https://registry.example/x', method: 'PUT', bodyHandle: second.value.handle })
  response(ctx, host, start({ operation: 'upload.end', handle: second.value.handle }))
  host.operation_cancel(late)
  assert.deepEqual(ctx.syscalls.at(-1), { op: 'net-close', handle: 5 })
  assert.deepEqual(response(ctx, host, start({ operation: 'upload.end', handle: second.value.handle })), { ok: true, value: null })
})

test('pnpm_host caps uploads and reports staging failures', () => {
  const ctx = fakeContext()
  ctx.traits = { crossOrigin: 'any' }
  const { pnpm_host: host } = createImports(ctx)
  const start = request => host.operation_start(...put(ctx, 64, JSON.stringify(request)))
  const upload = response(ctx, host, start({ operation: 'upload.create' }))
  ctx.fs.writeFile(`/tmp/.wasi-pnpm/upload-${upload.value.handle}/0`, { length: MAX_UPLOAD })
  assert.deepEqual(response(ctx, host, start({ operation: 'upload.write', handle: upload.value.handle, bytes: [1] })).error, { message: PUBLISH_TOO_LARGE, code: 'EFBIG' })
  ctx.fs.files.clear()
  const huge = response(ctx, host, start({ operation: 'upload.create' }))
  ctx.instance = () => ({ exports: { malloc: () => 0, free: () => {} } })
  assert.equal(response(ctx, host, start({ operation: 'network.request', url: 'https://registry.example/x', method: 'PUT', bodyHandle: huge.value.handle })).error.code, 'ENOMEM')
  ctx.fs.writeFile(`/tmp/.wasi-pnpm/upload-${huge.value.handle}/request`, new TextEncoder().encode('8 9999999'))
  assert.equal(response(ctx, host, start({ operation: 'upload.end', handle: huge.value.handle })).error.code, 'EIO')
  const prompt = response(ctx, host, start({ operation: 'terminal.password' }))
  assert.match(prompt.error.message, /--otp/)
})

function gitContext () {
  const ctx = fakeContext()
  ctx.traits = { crossOrigin: 'any' }
  ctx.env = { PNPM_SLICC_HTTPS_PROXY: 'http://127.0.0.1:3128', PNPM_SLICC_SSL_CERT_FILE: '/etc/ca.pem', PNPM_SLICC_NO_PROXY: '' }
  ctx.cwd = () => '/home/app'
  ctx.spawned = []
  ctx.killed = []
  ctx.spawn = options => {
    ctx.spawned.push(options)
    return { pid: 7, stdin: options.stdin === 'pipe' ? 20 : undefined, stdout: 21, stderr: 22 }
  }
  ctx.kill = (pid, sig) => {
    ctx.killed.push([pid, sig])
    if (sig === 2) throw new Error('gone')
  }
  return ctx
}

test('pnpm_host runs git through the kernel with the proxy env restored', () => {
  const ctx = gitContext()
  const { pnpm_host: host } = createImports(ctx)
  const start = request => host.operation_start(...put(ctx, 64, JSON.stringify(request)))
  const spawned = response(ctx, host, start({ operation: 'process.spawn', program: '/usr/bin/git', args: ['ls-remote', '--', 'https://github.com/a/b'], env: { HOME: '/home', PNPM_SLICC_X: 'y' }, stdin: 'null', stdout: 'pipe', stderr: 'pipe' }))
  assert.equal(spawned.value.pid, 7)
  assert.deepEqual(ctx.spawned[0].argv, ['git', 'ls-remote', '--', 'https://github.com/a/b'])
  assert.deepEqual(ctx.spawned[0].env, { HOME: '/home', https_proxy: 'http://127.0.0.1:3128', HTTPS_PROXY: 'http://127.0.0.1:3128', SSL_CERT_FILE: '/etc/ca.pem', GIT_SSL_CAINFO: '/etc/ca.pem' })
  assert.deepEqual([ctx.spawned[0].cwd, ctx.spawned[0].stdin, ctx.spawned[0].stdout], ['/home/app', 'null', 'pipe'])
  start({ operation: 'stream.read', handle: spawned.value.stdout, maxBytes: 999999 })
  assert.deepEqual(ctx.submitted.at(-1).request, { op: 'fd-read', fd: 21, max: 65536 })
  assert.match(response(ctx, host, start({ operation: 'process.write', handle: spawned.value.handle, bytes: [1] })).error.message, /not piped/)
  assert.deepEqual(response(ctx, host, start({ operation: 'process.end', handle: spawned.value.handle })), { ok: true, value: null })
  const wait = start({ operation: 'process.wait', handle: spawned.value.handle })
  assert.deepEqual(ctx.submitted.at(-1).request, { op: 'proc-wait', pid: 7, nohang: false })
  ctx.results.set(wait, [7, 256])
  assert.deepEqual(response(ctx, host, wait), { ok: true, value: { code: 1, signal: null, signalNumber: null } })
  const tryWait = start({ operation: 'process.tryWait', handle: spawned.value.handle })
  ctx.results.set(tryWait, [0, 0])
  assert.deepEqual(response(ctx, host, tryWait), { ok: true, value: null })
  assert.deepEqual(response(ctx, host, start({ operation: 'process.kill', handle: spawned.value.handle })), { ok: true, value: null })
  assert.deepEqual(response(ctx, host, start({ operation: 'process.kill', handle: spawned.value.handle, signal: 'SIGINT' })), { ok: true, value: null })
  assert.deepEqual(ctx.killed, [[7, 15], [7, 2]])
  assert.deepEqual(response(ctx, host, start({ operation: 'process.release', handle: spawned.value.handle })), { ok: true, value: null })
  assert.deepEqual(response(ctx, host, start({ operation: 'resource.close', handle: spawned.value.stdout })), { ok: true, value: null })
  assert.deepEqual(ctx.syscalls.at(-1), { op: 'fd-close', fd: 21 })
  assert.equal(host.resource_close(spawned.value.handle), 0)
  assert.deepEqual(ctx.killed.at(-1), [7, 9])
})

test('pnpm_host pipes git stdin and cleans up an unread spawn', () => {
  const ctx = gitContext()
  const { pnpm_host: host } = createImports(ctx)
  const start = request => host.operation_start(...put(ctx, 64, JSON.stringify(request)))
  const spawned = response(ctx, host, start({ operation: 'process.spawn', program: 'git', args: [], env: [['A', 'b']], stdin: 'pipe', stdout: 'ignore', stderr: 'inherit' }))
  assert.deepEqual([ctx.spawned[0].stdout, ctx.spawned[0].stderr, ctx.spawned[0].env.A], ['null', 'inherit', 'b'])
  start({ operation: 'process.write', handle: spawned.value.handle, bytes: [1, 2] })
  assert.equal(ctx.submitted.at(-1).request.op, 'fd-write')
  assert.deepEqual([...ctx.submitted.at(-1).request.body], [1, 2])
  start({ operation: 'process.closeStdin', handle: spawned.value.handle })
  assert.deepEqual(ctx.submitted.at(-1).request, { op: 'fd-close', fd: 20 })
  const unread = start({ operation: 'process.spawn', program: 'git', args: ['clone'] })
  assert.ok(host.response_len(unread) > 0)
  host.operation_cancel(unread)
  assert.deepEqual(ctx.syscalls.slice(-2), [{ op: 'fd-close', fd: 21 }, { op: 'fd-close', fd: 22 }])
  assert.deepEqual(ctx.killed.at(-1), [7, 9])
})

test('pnpm_host explains a missing git and a CORS-only transport', () => {
  const ctx = gitContext()
  const { pnpm_host: host } = createImports(ctx)
  const start = request => host.operation_start(...put(ctx, 64, JSON.stringify(request)))
  ctx.spawn = () => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }) }
  assert.deepEqual(response(ctx, host, start({ operation: 'process.spawn', program: 'git' })).error, { message: GIT_MISSING, code: 'ENOENT' })
  ctx.spawn = () => { throw new Error('boom') }
  assert.equal(response(ctx, host, start({ operation: 'process.spawn', program: 'git' })).error.message, 'git could not start: boom')
  ctx.spawn = () => { throw {} }
  assert.equal(response(ctx, host, start({ operation: 'process.spawn', program: 'git' })).error.code, 'EIO')
  const cors = fakeContext()
  cors.traits = { crossOrigin: 'cors' }
  const corsHost = createImports(cors).pnpm_host
  assert.equal(response(cors, corsHost, corsHost.operation_start(...put(cors, 64, JSON.stringify({ operation: 'process.spawn', program: 'git' })))).error.message, GIT_UNSUPPORTED)
})

test('helpers: wait statuses and child env', () => {
  assert.deepEqual(waitStatus(9), { code: null, signal: 'SIGKILL', signalNumber: 9 })
  assert.deepEqual(waitStatus(11), { code: null, signal: 'SIG11', signalNumber: 11 })
  assert.deepEqual(childEnv(undefined, undefined), {})
})

