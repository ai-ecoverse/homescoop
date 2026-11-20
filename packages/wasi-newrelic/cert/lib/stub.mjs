// The far end for wasi-newrelic's cert specs (ctx.serve): NerdGraph at
// api.newrelic.com and api.eu.newrelic.com as the specs need it, and every
// request logged in the page. download.newrelic.com (install recipes, the
// CLI's version file, nrdiag) answers 500, so a build that asks it shows it.

export const USER = 'cone'
export const HOME = `/home/${USER}`
export const KEY = 'NRAK-SEALEDPLACEHOLDER000000000'
export const QUERY = '{ actor { user { name } } }'

// Runs in the page. Self-contained: no closures over this module.
function responder (req) {
  const header = name => (req.headers.find(([key]) => key.toLowerCase() === name) || [])[1] || ''
  const body = req.body instanceof Uint8Array ? new TextDecoder().decode(req.body) : String(req.body || '')
  const url = new URL(req.url)
  window.newrelicLog.push({ method: req.method, url: req.url, key: header('api-key'), agent: header('user-agent'), body })
  const json = (status, value) => ({ status, statusText: status === 200 ? 'OK' : 'Error', headers: [['content-type', 'application/json']], body: JSON.stringify(value) })
  if (url.hostname === 'download.newrelic.com') return json(500, { message: 'download.newrelic.com is down in this cert' })
  if (url.hostname !== 'api.newrelic.com' && url.hostname !== 'api.eu.newrelic.com') return json(502, { message: `no such host in this cert: ${url.hostname}` })
  // NerdGraph answers a missing or unknown key with 401, as the real one does.
  if (!window.newrelicKeys.includes(header('api-key'))) return json(401, { errors: [{ message: 'authentication required' }] })
  if (req.method !== 'POST' || url.pathname !== '/graphql') return json(404, { message: `no ${req.method} ${url.pathname} in this cert` })
  const query = JSON.parse(body).query || ''
  if (/actor\s*{\s*user\s*{\s*name\s*}\s*}/.test(query)) return json(200, { data: { actor: { user: { name: `Cert User via ${url.hostname}` } } } })
  if (/nrql\s*\(/.test(query)) return json(200, { data: { actor: { account: { nrql: { results: [{ count: 42 }] } } } } })
  return json(200, { errors: [{ message: `no answer for this query in this cert: ${query.slice(0, 80)}` }] })
}

// keys: the Api-Key values NerdGraph accepts.
export async function stub (ctx, keys = [KEY]) {
  await ctx.page.evaluate(list => {
    window.newrelicLog = []
    window.newrelicKeys = list
  }, keys)
  await ctx.serve(responder)
}

export const requests = ctx => ctx.page.evaluate(() => window.newrelicLog)

export async function asUser (ctx, name = USER) {
  await ctx.addUser({ name })
  const home = `/home/${name}`
  return (argv, options = {}) => ctx.run(argv, { cwd: home, user: name, ...options, env: { HOME: home, ...(options.env ?? {}) } })
}

export const output = result => `${result.stdout}${result.stderr}`
