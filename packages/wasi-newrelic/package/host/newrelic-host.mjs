// newrelic's host imports (newrelic_host) for slicc-kernel. slicc-kernel
// loads this module for the newrelic command
// (slicc.commands.newrelic.imports) and passes a ctx for the process: memory,
// fs and syscall. newrelic.wasm sends JSON requests through call/take: send
// an HTTP request through the kernel's network and read its body, or set a
// file's mode.
//
// This is wasi-fastly's host module (packages/wasi-fastly/package/host/
// fastly-host.mjs, itself wasi-gh's without its command operations) with the
// import module renamed: the New Relic CLI for slicc starts no commands.
// Each operation is a generator that yields every ctx call it makes and gets
// its answer back. createImports (a kernel with blocking workers: a page,
// Node) drives them synchronously. createAsyncImports (the async process
// host: a Cloudflare Dynamic Worker, where every ctx call returns a promise)
// awaits each answer, and newrelic_host.call is an async function, so the
// kernel suspends newrelic.wasm with JSPI until it is done.

export const PROBE = 0x6e72636c // "nrcl"
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

// The kernel's network decodes gzip, deflate and br bodies unless it says
// decoded: false. Go must then not see the encoding, or it would decode twice.
export function responseHeaders (head) {
  const pairs = (head.headers ?? []).map(([name, value]) => [String(name), String(value)])
  if (head.decoded === false) return pairs
  const encoding = pairs.find(([name]) => name.toLowerCase() === 'content-encoding')?.[1]
  const decoded = encoding?.split(',').every(value => ['gzip', 'deflate', 'br'].includes(value.trim().toLowerCase()))
  if (!decoded) return pairs
  return pairs.filter(([name]) => !['content-encoding', 'content-length'].includes(name.toLowerCase()))
}

const reason = error => error?.message ?? String(error)

// A ctx call: `yield call(() => ctx.x(...))` answers what ctx.x returned, or
// throws what it threw, in either driver.
const call = fn => ({ call: fn })

export function * operations (ctx, request) {
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

  // wasip1 mkdir and open do not pass a mode, and wasip1 chmod does nothing.
  // newrelic asks for one after it creates ~/.newrelic, credentials.json
  // (which holds API keys) and config.json. mode is the permission bits.
  function * chmod ({ path, mode }) {
    if (typeof path !== 'string' || path === '' || !Number.isInteger(mode) || mode < 0 || mode > 0o777) {
      throw new Error('chmod needs a path and permission bits')
    }
    yield call(() => ctx.fs.chmod(path, mode))
    return null
  }

  const ops = { http, 'http.read': httpRead, 'http.close': httpClose, chmod }
  const op = ops[request?.op]
  if (!op) throw new Error(`unknown newrelic_host operation ${request?.op}`)
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
    newrelic_host: {
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
