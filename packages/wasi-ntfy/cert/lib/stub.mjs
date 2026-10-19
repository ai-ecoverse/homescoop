export const HOST = 'https://ntfy.test'
export const USER = 'cone'
export const HOME = `/home/${USER}`

function responder (req) {
  const header = name => (req.headers.find(([key]) => key.toLowerCase() === name) || [])[1] || ''
  const body = req.body instanceof Uint8Array ? req.body : new Uint8Array(0)
  window.ntfyLog.push({
    at: Date.now(),
    method: req.method,
    url: req.url,
    auth: header('authorization'),
    title: header('x-title'),
    length: body.length,
    text: body.length <= 65536 ? new TextDecoder().decode(body) : '',
  })
  const next = window.ntfyPlan.length > 0 ? window.ntfyPlan.shift() : window.ntfyFallback
  return {
    status: next.status ?? 200,
    statusText: next.statusText ?? '',
    headers: next.headers ?? [['content-type', 'application/json']],
    body: next.body ?? '',
  }
}

export const line = event => `${JSON.stringify(event)}\n`
export const lines = events => events.map(line).join('')
export const message = (id, time, text, extra = {}) => ({ id, time, event: 'message', topic: extra.topic ?? 'cert', message: text, ...extra })
export const open = time => ({ id: `open${time}`, time, event: 'open', topic: 'cert' })
export const stream = events => ({ status: 200, headers: [['content-type', 'application/x-ndjson']], body: lines(events) })
export const json = (status, value, headers = []) => ({ status, headers: [['content-type', 'application/json'], ...headers], body: `${JSON.stringify(value)}\n` })
export const UNAUTHORIZED = json(401, { code: 40101, http: 401, error: 'unauthorized' })
export const FORBIDDEN = json(403, { code: 40301, http: 403, error: 'forbidden' })
export const published = (id, text) => json(200, message(id, 1792326613, text))

export async function stub (ctx, plan, fallback = UNAUTHORIZED) {
  await ctx.page.evaluate(([steps, last]) => {
    window.ntfyLog = []
    window.ntfyPlan = steps
    window.ntfyFallback = last
  }, [plan, fallback])
  await ctx.serve(responder)
}

export const requests = ctx => ctx.page.evaluate(() => window.ntfyLog)

export async function asUser (ctx) {
  await ctx.addUser({ name: USER })
  return (argv, options = {}) => ctx.run(argv, { cwd: HOME, user: USER, ...options, env: { HOME, ...(options.env ?? {}) } })
}

export const bounded = argv => ['timeout', '90', ...argv]

export const output = result => `${result.stdout}${result.stderr}`
