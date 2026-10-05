import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createImports, envelope, errno, errorNumber, headerPairs, responseHeaders } from '../package/host/pnpm-host.mjs'

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
    stat (path) { return fs.lstat(path) },
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
    syscall (request) {
      syscalls.push(request)
      return 0
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
  assert.match(response(ctx, host, start({ operation: 'network.request', url: 'https://x.test/', bodyHandle: 1 })).error.message, /uploads/)
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
