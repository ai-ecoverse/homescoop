// pnpm's host imports (pnpm_atomic, pnpm_fs, pnpm_host) for slicc-kernel.
// slicc-kernel loads this module for the pnpm command
// (slicc.commands.<name>.imports) in every worker of the process and passes
// a ctx for that process: memory, fs, fds, syscall and async.

export const errno = {
  EACCES: 2, EAGAIN: 6, EBADF: 8, ECANCELED: 11, EEXIST: 20, EFAULT: 21,
  EINVAL: 28, EIO: 29, EISDIR: 31, ELOOP: 32, ENOENT: 44, ENOTDIR: 54,
  ENOTEMPTY: 55, ENOTSUP: 58, EPERM: 63, EWOULDBLOCK: 6,
}

const TYPE_BITS = { file: 0o100000, dir: 0o040000, symlink: 0o120000 }
const UMASK = 0o022
const DEFAULT_UID = 1000
const MAX_RESPONSE = 1024 * 1024

export function createImports (ctx) {
  return {
    pnpm_atomic: createAtomics(ctx),
    pnpm_fs: createFilesystem(ctx),
    pnpm_host: createHost(ctx),
  }
}

function createAtomics (ctx) {
  function wait (pointer, expected, timeout, offset, width) {
    const buffer = ctx.memory().buffer
    const address = (pointer >>> 0) + (offset >>> 0)
    if (address % width !== 0 || address + width > buffer.byteLength) {
      throw new WebAssembly.RuntimeError('Unaligned or out-of-bounds atomic wait')
    }
    const view = width === 4 ? new Int32Array(buffer) : new BigInt64Array(buffer)
    const ms = timeout < 0n ? Infinity : Number(timeout) / 1e6
    const result = Atomics.wait(view, address / width, expected, ms)
    return result === 'ok' ? 0 : result === 'not-equal' ? 1 : 2
  }
  return {
    wait32: (pointer, expected, timeout, offset) => wait(pointer, expected, timeout, offset, 4),
    wait64: (pointer, expected, timeout, offset) => wait(pointer, expected, timeout, offset, 8),
  }
}

export function errorNumber (error) {
  if (typeof error?.code === 'string' && error.code in errno) return errno[error.code]
  if (typeof error?.code === 'string' && /^E[A-Z]+$/.test(error.code)) return errno.EIO
  if (Number.isInteger(error?.errno) && error.errno > 0) return error.errno
  if (error instanceof RangeError) return errno.EFAULT
  return errno.EIO
}

function checked (operation) {
  return (...args) => {
    try {
      operation(...args)
      return 0
    } catch (error) {
      return errorNumber(error)
    }
  }
}

function fail (code, message = code) {
  return Object.assign(new Error(message), { code })
}

function kindOf (stat) {
  if (stat.isSymbolicLink || stat.kind === 'symlink') return 'symlink'
  if (stat.isDirectory || stat.kind === 'dir') return 'dir'
  return 'file'
}

function withType (stat) {
  const kind = kindOf(stat)
  const mode = (stat.mode ?? (kind === 'dir' ? 0o755 : kind === 'symlink' ? 0o777 : 0o644)) >>> 0
  return mode >= 0o10000 ? mode : (mode | TYPE_BITS[kind]) >>> 0
}

function createFilesystem (ctx) {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const uid = ctx.uid ?? DEFAULT_UID
  function guestPath (pointer, length) {
    const value = decoder.decode(Uint8Array.from(new Uint8Array(ctx.memory().buffer, pointer >>> 0, length >>> 0)))
    if (!value.startsWith('/') || value.includes('\0')) throw fail('EINVAL', 'Expected an absolute guest path')
    return value
  }
  function setU32 (pointer, value) {
    new DataView(ctx.memory().buffer).setUint32(pointer >>> 0, value >>> 0, true)
  }
  function open (pointer, length, output, options) {
    try {
      setU32(output, ctx.fds.open(guestPath(pointer, length), options))
      return 0
    } catch (error) {
      return errorNumber(error)
    }
  }
  function mkdirs (directory) {
    let current = ''
    for (const part of directory.split('/').filter(Boolean)) {
      current = `${current}/${part}`
      if (ctx.fs.exists(current)) continue
      try {
        ctx.fs.mkdir(current)
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
      }
    }
  }
  function components (directory, template) {
    const prefix = template.endsWith('/') ? template : `${template}/`
    if (!directory.startsWith(prefix) || directory.length === prefix.length) {
      throw fail('EINVAL', 'Permission target is not below its template')
    }
    const parts = directory.slice(prefix.length).split('/').filter(Boolean)
    if (parts.some(part => part === '.' || part === '..')) throw fail('EINVAL', 'Permission target is not below its template')
    return parts
  }
  return {
    create_new (pointer, length, mode, output) {
      if (mode < 0 || mode > 0o7777) return errno.EINVAL
      return open(pointer, length, output, { read: true, write: true, create: true, exclusive: true, mode, nofollow: true })
    },
    open_nofollow (pointer, length, output) {
      return open(pointer, length, output, { read: true, nofollow: true })
    },
    open_lock (pointer, length, output) {
      return open(pointer, length, output, { read: true, write: true, nofollow: true })
    },
    open_directory_nofollow_beneath (pointer, length, templatePointer, templateLength, output) {
      try {
        const directory = guestPath(pointer, length)
        let current = guestPath(templatePointer, templateLength).replace(/\/+$/, '')
        for (const part of components(directory, current)) {
          current = `${current}/${part}`
          const kind = kindOf(ctx.fs.lstat(current))
          if (kind === 'symlink') return errno.ELOOP
          if (kind !== 'dir') return errno.ENOTDIR
        }
        setU32(output, ctx.fds.open(directory, { read: true, directory: true, nofollow: true }))
        return 0
      } catch (error) {
        return errorNumber(error)
      }
    },
    grant_directory_mode_beneath () {
      return errno.ENOTSUP
    },
    try_lock (descriptor, exclusive) {
      try {
        return ctx.fds.tryLock(descriptor, exclusive !== 0)
      } catch (error) {
        return errorNumber(error)
      }
    },
    sqlite_register: checked(() => {}),
    path_access_executable: checked((pointer, length) => {
      const file = guestPath(pointer, length)
      if ((ctx.fs.stat(file).mode & 0o111) === 0) throw fail('EACCES', `File is not executable: ${file}`)
    }),
    check_owner: checked(descriptor => {
      if ((ctx.fds.fstat(descriptor).uid ?? uid) !== uid) throw fail('EACCES', 'WASM SQLite stores must belong to the current user')
    }),
    fchmod: checked((descriptor, mode) => ctx.fds.fchmod(descriptor, mode & 0o7777)),
    fmode: checked((descriptor, output) => setU32(output, withType(ctx.fds.fstat(descriptor)))),
    lmode: checked((pointer, length, output) => setU32(output, withType(ctx.fs.lstat(guestPath(pointer, length))))),
    umask: () => UMASK,
    uid: () => uid,
    secure_directory: checked((pointer, length) => {
      const directory = guestPath(pointer, length)
      mkdirs(directory)
      const stat = ctx.fs.lstat(directory)
      if (kindOf(stat) !== 'dir') throw fail('ENOTDIR', `Lock directory is not a directory: ${directory}`)
      if ((stat.uid ?? uid) !== uid) throw fail('EACCES', 'Lock directory has a different owner')
      ctx.fs.chmod(directory, 0o700)
    }),
  }
}

const UNSUPPORTED = {
  'upload.create': 'HTTP uploads are not supported in slicc (pnpm publish needs them)',
  'upload.write': 'HTTP uploads are not supported in slicc',
  'upload.end': 'HTTP uploads are not supported in slicc',
  'process.spawn': 'Lifecycle scripts cannot run in slicc yet; install with --ignore-scripts',
  'shell.spawn': 'Lifecycle scripts cannot run in slicc yet; install with --ignore-scripts',
  'terminal.open': 'No interactive terminal in slicc',
  'terminal.prompt': 'No interactive terminal in slicc',
  'terminal.confirm': 'No interactive terminal in slicc',
  'terminal.input': 'No interactive terminal in slicc',
  'terminal.password': 'No interactive terminal in slicc',
}

export function headerPairs (headers) {
  if (headers == null) return []
  const pairs = Array.isArray(headers) ? headers : Object.entries(headers)
  return pairs.map(([name, value]) => [String(name), String(value)])
}

export function responseHeaders (head) {
  const pairs = headerPairs(head.headers)
  if (head.decoded === false) return pairs
  const encoding = pairs.find(([name]) => name.toLowerCase() === 'content-encoding')?.[1]
  const decoded = encoding?.split(',').every(value => ['gzip', 'deflate', 'br'].includes(value.trim().toLowerCase()))
  if (!decoded) return pairs
  return pairs.filter(([name]) => !['content-encoding', 'content-length'].includes(name.toLowerCase()))
}

export function fromTaken (taken) {
  if (taken === undefined) return undefined
  if (typeof taken.error === 'string') return { ok: false, error: { message: taken.error, code: taken.error } }
  return envelope(taken.value)
}

export function envelope (result) {
  if (result instanceof Error || (result && typeof result === 'object' && Number.isInteger(result.errno) && !('status' in result))) {
    return { ok: false, error: { message: result.message ?? `errno ${result.errno}`, code: result.code ?? null } }
  }
  if (result && typeof result === 'object' && typeof result.ok === 'boolean') return result
  if (result instanceof Uint8Array) return { ok: true, value: { bytes: Array.from(result), done: result.length === 0 } }
  if (result && typeof result === 'object' && 'status' in result && 'handle' in result) {
    return { ok: true, value: { handle: result.handle, status: result.status, headers: responseHeaders(result), url: result.url } }
  }
  return { ok: true, value: result ?? null }
}

function errorEnvelope (message, code = 'ENOTSUP') {
  return { ok: false, error: { message, code } }
}

function createHost (ctx) {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const encoder = new TextEncoder()
  const ready = new Map()

  function networkRequest (request) {
    let url
    try {
      url = new URL(request.url)
    } catch {
      return ctx.async.resolve(errorEnvelope('Invalid HTTP request URL', 'EINVAL'))
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return ctx.async.resolve(errorEnvelope(`Unsupported HTTP protocol: ${url.protocol}`, 'EINVAL'))
    }
    if (request.bodyHandle != null) return ctx.async.resolve(errorEnvelope(UNSUPPORTED['upload.create']))
    return ctx.async.submit({
      op: 'net-request',
      url: url.href,
      method: request.method ?? 'GET',
      headers: headerPairs(request.headers),
      body: Array.isArray(request.body) ? Uint8Array.from(request.body) : request.body ?? undefined,
      timeoutMs: request.timeoutMs,
      totalTimeoutMs: request.totalTimeoutMs,
    })
  }

  function start (request) {
    switch (request.operation) {
    case 'network.request': return networkRequest(request)
    case 'stream.read': return ctx.async.submit({ op: 'net-read', handle: request.handle, max: Math.min(request.maxBytes ?? 65536, 65536) })
    case 'resource.close': return ctx.async.submit({ op: 'net-close', handle: request.handle })
    case 'signal.next': return ctx.async.hold()
    case 'terminal.status': return ctx.async.resolve({ ok: true, value: { stdin: false, stdout: false, stderr: false } })
    default:
      return ctx.async.resolve(errorEnvelope(UNSUPPORTED[request.operation] ?? `Unknown WASM host operation: ${request.operation}`))
    }
  }

  function take (id) {
    let response
    try {
      response = fromTaken(ctx.async.take(id))
    } catch (error) {
      response = envelope(error)
    }
    if (response === undefined) return undefined
    let bytes = encoder.encode(JSON.stringify(response))
    if (bytes.length > MAX_RESPONSE) bytes = encoder.encode(JSON.stringify(errorEnvelope('WASM host response exceeds the transfer limit', 'EIO')))
    return bytes
  }

  function closeUnread (bytes) {
    const response = JSON.parse(decoder.decode(bytes))
    if (response.ok && Number.isInteger(response.value?.handle)) {
      try {
        ctx.syscall({ op: 'net-close', handle: response.value.handle })
      } catch {}
    }
  }

  return {
    operation_start (pointer, length) {
      if ((length >>> 0) > MAX_RESPONSE) return -2
      try {
        const request = JSON.parse(decoder.decode(Uint8Array.from(new Uint8Array(ctx.memory().buffer, pointer >>> 0, length >>> 0))))
        return start(request)
      } catch {
        return -2
      }
    },
    response_len (id) {
      if (!ready.has(id)) {
        const bytes = take(id)
        if (bytes === undefined) return -1
        ready.set(id, bytes)
      }
      return ready.get(id).length
    },
    response_read (id, pointer, length) {
      const bytes = ready.get(id)
      if (!bytes || bytes.length > (length >>> 0)) return -2
      ready.delete(id)
      new Uint8Array(ctx.memory().buffer, pointer >>> 0, bytes.length).set(bytes)
      return bytes.length
    },
    operation_cancel (id) {
      const unread = ready.get(id)
      ready.delete(id)
      if (unread) closeUnread(unread)
      ctx.async.cancel(id)
    },
    resource_close (handle) {
      try {
        ctx.syscall({ op: 'net-close', handle })
        return 0
      } catch {
        return -1
      }
    },
    wait_completion () {
      return ctx.async.wait()
    },
  }
}
