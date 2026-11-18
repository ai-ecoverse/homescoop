// gh's host imports (gh_host) for slicc-kernel. slicc-kernel loads this
// module for the gh command (slicc.commands.gh.imports) and passes a ctx
// for the process: memory, fs, spawn/wait, syscall and async. gh.wasm sends
// JSON requests through call/take: start a command and wait for it, or send
// an HTTP request and read its body.
//
// Each operation is a generator that yields every ctx call it makes and gets
// its answer back. createImports (a kernel with blocking workers: a page,
// Node) drives them synchronously. createAsyncImports (the async process
// host: a Cloudflare Dynamic Worker, where every ctx call returns a promise)
// awaits each answer, and gh_host.call is an async function, so the kernel
// suspends gh.wasm with JSPI until it is done.

export const PROBE = 0x67683131
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

// A ctx call: `yield call(() => ctx.x(...))` answers what ctx.x returned, or
// throws what it threw, in either driver.
const call = fn => ({ call: fn })

export function * operations (ctx, request) {
  function * which ({ name }) {
    if (typeof name !== 'string' || name === '') return ''
    if (name.includes('/')) return (yield call(() => ctx.fs.exists(name))) ? name : ''
    const dirs = (ctx.env?.PATH ?? '/usr/bin:/bin').split(':').filter(Boolean)
    for (const dir of dirs) {
      if (yield call(() => ctx.fs.exists(`${dir}/${name}`))) return `${dir}/${name}`
    }
    // Installed slicc commands (git from @ai-ecoverse/wasm-git) are names,
    // not files on PATH. Spawn resolves them; a missing name fails there.
    return name
  }

  function * run ({ argv, env, dir, stdin, inherit }) {
    let child
    try {
      // gh's git client sets Cmd.Stdin to the process stdin. Slurping that
      // waits for EOF, so an interactive shell never reaches spawn. Inherit
      // the fd instead. A reader gh supplied (a buffer) is still piped.
      const cwd = dir || (yield call(() => ctx.cwd()))
      child = yield call(() => ctx.spawn({ argv, env: envObject(env), cwd, stdin: inherit ? 'inherit' : 'pipe', stdout: 'pipe', stderr: 'pipe' }))
    } catch (error) {
      const code = error?.code ?? reason(error)
      throw new Error(code === 'ENOENT' ? `exec: "${argv[0]}": executable file not found in $PATH` : `exec: "${argv[0]}": ${code}`)
    }
    const pending = new Map()
    const output = { stdout: [], stderr: [] }
    let input = inherit ? new Uint8Array(0) : fromBase64(stdin)
    function * read (stream) {
      pending.set(yield call(() => ctx.async.submit({ op: 'fd-read', fd: child[stream], max: READ_MAX })), stream)
    }
    function * write () {
      if (inherit) return
      if (input.length === 0) {
        yield call(() => ctx.syscall({ op: 'fd-close', fd: child.stdin }))
        return
      }
      pending.set(yield call(() => ctx.async.submit({ op: 'fd-write', fd: child.stdin, body: input })), 'stdin')
    }
    yield * write()
    yield * read('stdout')
    yield * read('stderr')
    while (pending.size > 0) {
      const id = yield call(() => ctx.async.wait())
      const stream = pending.get(id)
      if (stream === undefined) continue
      pending.delete(id)
      const taken = yield call(() => ctx.async.take(id))
      if (taken?.error !== undefined) {
        if (stream === 'stdin') {
          input = new Uint8Array(0)
          yield * write()
          continue
        }
        yield call(() => ctx.syscall({ op: 'fd-close', fd: child[stream] }))
        continue
      }
      if (stream === 'stdin') {
        const written = Number(taken?.value)
        input = written > 0 ? input.subarray(written) : new Uint8Array(0)
        yield * write()
        continue
      }
      const bytes = taken?.value
      if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
        yield call(() => ctx.syscall({ op: 'fd-close', fd: child[stream] }))
        continue
      }
      output[stream].push(bytes)
      yield * read(stream)
    }
    const { status } = yield call(() => ctx.wait(child.pid))
    return { status, stdout: toBase64(concat(output.stdout)), stderr: toBase64(concat(output.stderr)) }
  }

  function * http ({ method, url, headers, body }) {
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
      head = yield call(() => ctx.syscall({ op: 'net-request', url: target.href, method: method || 'GET', headers: headers ?? [], ...(bytes.length ? { body: bytes } : {}) }))
    } catch (error) {
      throw new Error(`could not reach ${target.host} (${error?.code ?? reason(error)})`)
    }
    return { handle: head.handle, status: head.status, headers: responseHeaders(head) }
  }

  function * httpRead ({ handle }) {
    const bytes = yield call(() => ctx.syscall({ op: 'net-read', handle, max: READ_MAX }))
    return toBase64(bytes instanceof Uint8Array ? bytes : new Uint8Array(0))
  }

  function * httpClose ({ handle }) {
    yield call(() => ctx.syscall({ op: 'net-close', handle }))
    return null
  }

  // wasip1 mkdir and open do not pass a mode. gh asks for one after it
  // creates a config directory or hosts.yml. mode is the permission bits.
  function * chmod ({ path, mode }) {
    if (typeof path !== 'string' || path === '' || !Number.isInteger(mode)) {
      throw new Error('chmod needs a path and a mode')
    }
    yield call(() => ctx.fs.chmod(path, mode))
    return null
  }

  const ops = { which, run, http, 'http.read': httpRead, 'http.close': httpClose, chmod }
  const op = ops[request?.op]
  if (!op) throw new Error(`unknown gh_host operation ${request?.op}`)
  return yield * op(request)
}

function runSync (steps) {
  let step = steps.next()
  while (!step.done) {
    let value
    try {
      value = step.value.call()
    } catch (error) {
      step = steps.throw(error)
      continue
    }
    step = steps.next(value)
  }
  return step.value
}

async function runAsync (steps) {
  let step = steps.next()
  while (!step.done) {
    let value
    try {
      value = await step.value.call()
    } catch (error) {
      step = steps.throw(error)
      continue
    }
    step = steps.next(value)
  }
  return step.value
}

export function createHost (ctx) {
  return request => runSync(operations(ctx, request))
}

export function createAsyncHost (ctx) {
  return request => runAsync(operations(ctx, request))
}

function respond (state, response) {
  state.result = encoder.encode(JSON.stringify(response))
  return state.result.length
}

function table (ctx, state, call) {
  const bytes = () => new Uint8Array(ctx.memory().buffer)
  return {
    gh_host: {
      probe: () => PROBE,
      call,
      take: pointer => {
        bytes().set(state.result, pointer >>> 0)
        state.result = new Uint8Array(0)
      },
    },
  }
}

const parse = (ctx, pointer, size) => {
  const bytes = new Uint8Array(ctx.memory().buffer)
  return JSON.parse(decoder.decode(bytes.slice(pointer >>> 0, (pointer >>> 0) + (size >>> 0))))
}

export function createImports (ctx) {
  const handle = createHost(ctx)
  const state = { result: new Uint8Array(0) }
  return table(ctx, state, (pointer, size) => {
    try {
      return respond(state, { ok: true, value: handle(parse(ctx, pointer, size)) ?? null })
    } catch (error) {
      return respond(state, { ok: false, error: reason(error) })
    }
  })
}

export function createAsyncImports (ctx) {
  const handle = createAsyncHost(ctx)
  const state = { result: new Uint8Array(0) }
  return table(ctx, state, async (pointer, size) => {
    try {
      // Read the request before the first await: the memory can grow, and
      // the program is suspended, not gone, while the host works.
      const request = parse(ctx, pointer, size)
      return respond(state, { ok: true, value: (await handle(request)) ?? null })
    } catch (error) {
      return respond(state, { ok: false, error: reason(error) })
    }
  })
}
