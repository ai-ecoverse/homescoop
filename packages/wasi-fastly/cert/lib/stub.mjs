// The far end for wasi-fastly's cert specs (ctx.serve): api.fastly.com as
// the specs need it, and every request logged in the page. accounts.fastly.com
// answers 500 and api.github.com / developer.fastly.com offer a newer CLI,
// so a build that asked them (upstream's OpenID Connect fetch before every
// API call, its update check) shows it in the output or the log.

export const USER = 'cone'
export const HOME = `/home/${USER}`
export const TOKEN = 'sealed-placeholder'
export const SERVICE_ID = 'SU1Z0isxPaozGVKXdv0eY'

// Runs in the page. Self-contained: no closures over this module.
function responder (req) {
  const header = name => (req.headers.find(([key]) => key.toLowerCase() === name) || [])[1] || ''
  const body = req.body instanceof Uint8Array ? new TextDecoder().decode(req.body) : String(req.body || '')
  const url = new URL(req.url)
  window.fastlyLog.push({ method: req.method, url: req.url, key: header('fastly-key'), agent: header('user-agent'), body })
  const json = (status, value) => ({ status, statusText: status === 200 ? 'OK' : 'Error', headers: [['content-type', 'application/json']], body: JSON.stringify(value) })
  if (url.hostname === 'accounts.fastly.com') return json(500, { error: 'accounts.fastly.com is down in this cert' })
  if (url.hostname === 'api.github.com' || url.hostname === 'developer.fastly.com') {
    return json(200, { tag_name: 'v99.0.0', name: 'v99.0.0', version: '99.0.0', url: 'https://example.invalid/fastly.tar.gz' })
  }
  if (url.hostname !== 'api.fastly.com') return json(502, { msg: `no such host in this cert: ${url.hostname}` })
  const key = header('fastly-key')
  if (!window.fastlyTokens.includes(key)) return json(401, { msg: 'Provided credentials are missing or invalid' })
  const service = { id: 'SU1Z0isxPaozGVKXdv0eY', name: `cert-service for ${key}`, type: 'vcl', version: 3, customer_id: 'c1', created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-02T10:00:00Z', versions: [{ number: 3, active: true, service_id: 'SU1Z0isxPaozGVKXdv0eY' }] }
  if (req.method === 'GET' && url.pathname === '/service') return json(200, [service])
  if (req.method === 'POST' && url.pathname === '/service') {
    const form = new URLSearchParams(body)
    return json(200, { ...service, id: 'NEWSERVICE0000000000a', name: form.get('name'), type: form.get('type'), version: 1 })
  }
  if (url.pathname === '/tokens/self') return json(200, { id: 'tok1', name: 'cert-token', user_id: 'u1', customer_id: 'c1', scope: 'global', created_at: '2026-11-01T10:00:00Z' })
  if (url.pathname === '/current_user') return json(200, { id: 'u1', login: 'cert@example.invalid', name: 'Cert', customer_id: 'c1' })
  if (url.pathname === '/current_customer') return json(200, { id: 'c1', name: 'Cert Customer' })
  return json(404, { msg: `no ${req.method} ${url.pathname} in this cert` })
}

// tokens: the Fastly-Key values api.fastly.com accepts.
export async function stub (ctx, tokens = [TOKEN]) {
  await ctx.page.evaluate(list => {
    window.fastlyLog = []
    window.fastlyTokens = list
  }, tokens)
  await ctx.serve(responder)
}

export const requests = ctx => ctx.page.evaluate(() => window.fastlyLog)

export async function asUser (ctx, name = USER) {
  await ctx.addUser({ name })
  const home = `/home/${name}`
  return (argv, options = {}) => ctx.run(argv, { cwd: home, user: name, ...options, env: { HOME: home, ...(options.env ?? {}) } })
}

export const output = result => `${result.stdout}${result.stderr}`
