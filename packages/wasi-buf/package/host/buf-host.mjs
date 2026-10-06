// buf's host imports (buf_host) for slicc-kernel. slicc-kernel loads this
// module for the buf command (slicc.commands.buf.imports) and passes a ctx
// for the process: memory, fs, spawn/wait, syscall and async. buf.wasm sends
// JSON requests through call/take: start a command and wait for it, or send an
// HTTP request and read its body.

export const PROBE = 0x62756631
const READ_MAX = 65536
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function fromBase64 (text) {
  if (!text) return new Uint8Array(0)
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(text)
  return Uint8Array.from(atob(text), c => c.charCodeAt(0))
}

export function toBase64 (bytes) {
  if (typeof bytes?.toBase64 === 'function') return bytes.toBase64()
  let binary = ''
  for (let at = 0; at < bytes.length; at += 32768) binary += String.fromCharCode(...bytes.subarray(at, at + 32768))
  return btoa(binary)
}

export function envObject (env) {
  const out = {}
  for (const entry of env ?? []) {
    const at = entry.indexOf('=')
    if (at > 0) out[entry.slice(0, at)] = entry.slice(at + 1)
  }
  return out
}

export function responseHeaders (head) {
  const pairs = (head.headers ?? []).map(([name, value]) => [String(name), String(value)])
  if (head.decoded === false) return pairs
  const encoding = pairs.find(([name]) => name.toLowerCase() === 'content-encoding')?.[1]
  const decoded = encoding?.split(',').every(value => ['gzip', 'deflate', 'br'].includes(value.trim().toLowerCase()))
  if (!decoded) return pairs
  return pairs.filter(([name]) => !['content-encoding', 'content-length'].includes(name.toLowerCase()))
}

const concat = parts => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const reason = error => error?.message ?? String(error)

export function createHost (ctx) {
  function which ({ name }) {
    if (typeof name !== 'string' || name === '') return ''
    if (name.includes('/')) return ctx.fs.exists(name) ? name : ''
    const dirs = (ctx.env?.PATH ?? '/usr/bin:/bin').split(':').filter(Boolean)
    for (const dir of dirs) {
      if (ctx.fs.exists(`${dir}/${name}`)) return `${dir}/${name}`
    }
    return ''
  }

  function run ({ argv, env, dir, stdin }) {
    let child
    try {
      child = ctx.spawn({ argv, env: envObject(env), cwd: dir || ctx.cwd(), stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
    } catch (error) {
      const code = error?.code ?? reason(error)
      throw new Error(code === 'ENOENT' ? `exec: "${argv[0]}": executable file not found in $PATH` : `exec: "${argv[0]}": ${code}`)
    }
    const pending = new Map()
    const output = { stdout: [], stderr: [] }
    let input = fromBase64(stdin)
    const read = stream => pending.set(ctx.async.submit({ op: 'fd-read', fd: child[stream], max: READ_MAX }), stream)
    const write = () => {
      if (input.length === 0) {
        ctx.syscall({ op: 'fd-close', fd: child.stdin })
        return
      }
      pending.set(ctx.async.submit({ op: 'fd-write', fd: child.stdin, body: input }), 'stdin')
    }
    write()
    read('stdout')
    read('stderr')
    while (pending.size > 0) {
      const id = ctx.async.wait()
      const stream = pending.get(id)
      if (stream === undefined) continue
      pending.delete(id)
      const taken = ctx.async.take(id)
      if (taken?.error !== undefined) {
        if (stream === 'stdin') {
          input = new Uint8Array(0)
          write()
          continue
        }
        ctx.syscall({ op: 'fd-close', fd: child[stream] })
        continue
      }
      if (stream === 'stdin') {
        const written = Number(taken?.value)
        input = written > 0 ? input.subarray(written) : new Uint8Array(0)
        write()
        continue
      }
      const bytes = taken?.value
      if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
        ctx.syscall({ op: 'fd-close', fd: child[stream] })
        continue
      }
      output[stream].push(bytes)
      read(stream)
    }
    const { status } = ctx.wait(child.pid)
    return { status, stdout: toBase64(concat(output.stdout)), stderr: toBase64(concat(output.stderr)) }
  }

  function http ({ method, url, headers, body }) {
    let target
    try {
      target = new URL(url)
    } catch {
      throw new Error(`invalid URL ${url}`)
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error(`unsupported protocol ${target.protocol}`)
    const bytes = fromBase64(body)
    let head
    try {
      head = ctx.syscall({ op: 'net-request', url: target.href, method: method || 'GET', headers: headers ?? [], ...(bytes.length ? { body: bytes } : {}) })
    } catch (error) {
      throw new Error(`could not reach ${target.host} (${error?.code ?? reason(error)})`)
    }
    return { handle: head.handle, status: head.status, headers: responseHeaders(head) }
  }

  function httpRead ({ handle }) {
    const bytes = ctx.syscall({ op: 'net-read', handle, max: READ_MAX })
    return toBase64(bytes instanceof Uint8Array ? bytes : new Uint8Array(0))
  }

  function httpClose ({ handle }) {
    ctx.syscall({ op: 'net-close', handle })
    return null
  }

  function lock ({ fd, exclusive }) {
    return ctx.fds.tryLock(fd, exclusive !== false) === 0
  }

  function unlock ({ fd }) {
    ctx.fds.unlock(fd)
    return null
  }

  const ops = { which, run, http, 'http.read': httpRead, 'http.close': httpClose, lock, unlock }
  return request => {
    const op = ops[request?.op]
    if (!op) throw new Error(`unknown buf_host operation ${request?.op}`)
    return op(request)
  }
}

export function createImports (ctx) {
  const handle = createHost(ctx)
  let result = new Uint8Array(0)
  const bytes = () => new Uint8Array(ctx.memory().buffer)
  return {
    buf_host: {
      probe: () => PROBE,
      call: (pointer, size) => {
        let response
        try {
          const request = JSON.parse(decoder.decode(bytes().slice(pointer >>> 0, (pointer >>> 0) + (size >>> 0))))
          response = { ok: true, value: handle(request) ?? null }
        } catch (error) {
          response = { ok: false, error: reason(error) }
        }
        result = encoder.encode(JSON.stringify(response))
        return result.length
      },
      take: pointer => {
        bytes().set(result, pointer >>> 0)
        result = new Uint8Array(0)
      },
    },
  }
}
