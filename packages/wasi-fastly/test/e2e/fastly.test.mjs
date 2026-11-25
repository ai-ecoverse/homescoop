// End-to-end: fastly.wasm and host/fastly-host.mjs on slicc-kernel's
// headless Node entry, with a network transport that records every request
// and answers for api.fastly.com itself. Nothing leaves the machine.
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { attachKernel, createNodeKernel } from '@ai-ecoverse/slicc-kernel/node'
import { agentPattern, versionPattern } from '../../cert/lib/version.mjs'

const PACKAGE = fileURLToPath(new URL('../../package/', import.meta.url))
const HOME = '/home/app'
const TOKEN = 'sealed-placeholder'
const SERVICE = { id: 'SU1Z0isxPaozGVKXdv0eY', name: 'cert-service', type: 'vcl', version: 3, created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-02T10:00:00Z', versions: [{ number: 3, active: true }] }

function recorder () {
  const seen = []
  const json = (status, value) => ({ status, statusText: status === 200 ? 'OK' : 'Error', headers: [['content-type', 'application/json']], body: JSON.stringify(value) })
  const answer = request => {
    const url = new URL(request.url)
    const header = name => Object.entries(request.headers ?? {}).concat(Array.isArray(request.headers) ? request.headers : [])
      .find(([key]) => key.toLowerCase() === name)?.[1] ?? ''
    seen.push({ method: request.method, url: request.url, key: header('fastly-key'), agent: header('user-agent') })
    if (url.hostname !== 'api.fastly.com') return json(503, { msg: `not reachable in this test: ${url.hostname}` })
    if (header('fastly-key') === '') return json(401, { msg: 'Provided credentials are missing or invalid' })
    if (url.pathname === '/service') return json(200, [{ ...SERVICE, name: `cert-service for ${header('fastly-key')}` }])
    if (url.pathname === '/tokens/self') return json(200, { id: 'tok1', name: 'cert-token', user_id: 'u1', customer_id: 'c1', scope: 'global', created_at: '2026-11-01T10:00:00Z' })
    if (url.pathname === '/current_user') return json(200, { id: 'u1', login: 'cert@example.invalid', name: 'Cert', customer_id: 'c1' })
    return json(404, { msg: `no ${url.pathname}` })
  }
  const transport = {
    traits: { manualRedirects: true, encodedBodies: false, crossOrigin: 'any' },
    async fetch (request) {
      const response = answer(request)
      const body = new TextEncoder().encode(response.body)
      return {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: (async function * () { yield body })(),
        cancel () {},
      }
    },
  }
  return { transport, seen }
}

async function install (kernel, { hostModule = true } = {}) {
  for (const entry of await readdir(PACKAGE, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const file = join(entry.parentPath, entry.name)
    const name = relative(PACKAGE, file)
    let data = await readFile(file)
    if (!hostModule && name === 'package.json') {
      const manifest = JSON.parse(data)
      delete manifest.slicc.commands.fastly.imports
      data = Buffer.from(JSON.stringify(manifest))
    }
    await kernel.writeFile(`/node_modules/@ai-ecoverse/wasi-fastly/${name}`, data)
  }
}

async function kernelWith ({ hostModule = true, blocking } = {}) {
  const { transport, seen } = recorder()
  const kernel = await createNodeKernel({
    network: { transport },
    ...(blocking === 'async' ? { blocking: 'async', emscripten: 'kernel' } : {}),
  })
  await install(kernel, { hostModule })
  await kernel.writeFile(`${HOME}/.keep`, '')
  return { kernel, seen }
}

const output = result => `${result.stdout}${result.stderr}`
const run = (kernel, argv, { env = {}, stdin } = {}) =>
  kernel.run(['fastly', ...argv], { cwd: HOME, env: { HOME, ...env }, ...(stdin === undefined ? {} : { stdin }) })

test('fastly version and --help run without the network', async () => {
  const { kernel, seen } = await kernelWith()
  try {
    const version = await run(kernel, ['version'])
    assert.equal(version.status, 0, output(version))
    assert.match(version.stdout, versionPattern())
    const help = await run(kernel, ['--help'])
    assert.equal(help.status, 0, output(help))
    assert.match(output(help), /A tool to interact with the Fastly API/)
    assert.deepEqual(seen, [])
  } finally {
    kernel.terminate()
  }
})

for (const blocking of ['sync', 'async']) {
  test(`FASTLY_API_TOKEN reaches api.fastly.com as Fastly-Key, and nothing else is asked (${blocking} host)`, async () => {
    const { kernel, seen } = await kernelWith({ blocking })
    try {
      const list = await run(kernel, ['service', 'list', '--json'], { env: { FASTLY_API_TOKEN: TOKEN } })
      assert.equal(list.status, 0, output(list))
      const services = JSON.parse(list.stdout)
      assert.equal(services[0].ServiceName ?? services[0].Name ?? services[0].name, `cert-service for ${TOKEN}`)
      // No OpenID Connect metadata (0004), no update check (0003): one
      // request, the command's own.
      assert.equal(seen.length, 1, JSON.stringify(seen))
      assert.equal(new URL(seen[0].url).origin, 'https://api.fastly.com')
      assert.equal(seen[0].key, TOKEN)
      assert.match(seen[0].agent, agentPattern())
    } finally {
      kernel.terminate()
    }
  })
}

test('auth add stores the token in ~/.config/fastly/config.toml, 0600 in a 0700 directory', async () => {
  const { kernel, seen } = await kernelWith()
  try {
    const add = await run(kernel, ['auth', 'add', 'work', '--api-token', 'stored-token'])
    assert.equal(add.status, 0, output(add))
    const config = new TextDecoder().decode(await kernel.readFile(`${HOME}/.config/fastly/config.toml`))
    assert.match(config, /token = "stored-token"/)
    const client = await attachKernel(await kernel.connect())
    try {
      assert.equal((await client.fs.stat(`${HOME}/.config/fastly`)).mode & 0o777, 0o700)
      assert.equal((await client.fs.stat(`${HOME}/.config/fastly/config.toml`)).mode & 0o777, 0o600)
    } finally {
      client.detach?.()
    }
    seen.length = 0
    const list = await run(kernel, ['service', 'list', '--json'])
    assert.equal(list.status, 0, output(list))
    assert.doesNotMatch(list.stderr, /Unprotected configuration file/)
    assert.equal(seen.length, 1, JSON.stringify(seen))
    assert.equal(seen[0].key, 'stored-token')
  } finally {
    kernel.terminate()
  }
})

test('XDG_CONFIG_HOME moves the config file', async () => {
  const { kernel } = await kernelWith()
  try {
    const add = await run(kernel, ['auth', 'add', 'xdg', '--api-token', 'xdg-token'], { env: { XDG_CONFIG_HOME: `${HOME}/xdg` } })
    assert.equal(add.status, 0, output(add))
    const config = new TextDecoder().decode(await kernel.readFile(`${HOME}/xdg/fastly/config.toml`))
    assert.match(config, /token = "xdg-token"/)
  } finally {
    kernel.terminate()
  }
})

test('auth login takes a piped token', async () => {
  const { kernel } = await kernelWith()
  try {
    const login = await run(kernel, ['auth', 'login'], { stdin: 'piped-token\n' })
    assert.equal(login.status, 0, output(login))
    assert.match(output(login), /token stored as "cert-token"/)
    const config = new TextDecoder().decode(await kernel.readFile(`${HOME}/.config/fastly/config.toml`))
    assert.match(config, /token = "piped-token"/)
  } finally {
    kernel.terminate()
  }
})

test('commands that need a native toolchain, a local port or a new binary refuse with a reason', async () => {
  const { kernel, seen } = await kernelWith()
  try {
    await kernel.writeFile(`${HOME}/recv.vcl`, 'set req.http.X-Cert = "1";\n')
    for (const [argv, message] of [
      [['compute', 'build'], /building a Compute package is not available in the Fastly CLI for slicc/],
      [['compute', 'publish'], /building a Compute package is not available in the Fastly CLI for slicc/],
      [['compute', 'serve'], /'fastly compute serve' is not available in the Fastly CLI for slicc: it builds the package and runs it under Viceroy/],
      [['compute', 'init'], /'fastly compute init' is not available/],
      [['compute', 'install-tools'], /'fastly compute install-tools' is not available/],
      [['vcl', 'serve', 'recv.vcl'], /'fastly vcl serve' is not available in the Fastly CLI for slicc: it publishes the VCL to a Fiddle sandbox/],
      [['update'], /'fastly update' is not available/],
      [['auth', 'login', '--sso', '--token', 'work'], /SSO is not available in the Fastly CLI for slicc: it waits for the browser to come back to http:\/\/localhost:8080\/callback/],
    ]) {
      const result = await run(kernel, argv, { env: { FASTLY_API_TOKEN: TOKEN } })
      assert.equal(result.status, 1, `fastly ${argv.join(' ')}: ${output(result)}`)
      assert.match(output(result), message, `fastly ${argv.join(' ')}`)
    }
    // No OpenID Connect metadata for a refused SSO, nothing for the rest.
    assert.deepEqual(seen, [])
  } finally {
    kernel.terminate()
  }
})

test('without the host module, API calls report that the runtime cannot open a connection', async () => {
  const { kernel, seen } = await kernelWith({ hostModule: false })
  try {
    const version = await run(kernel, ['version'])
    assert.equal(version.status, 0, output(version))
    const list = await run(kernel, ['service', 'list'], { env: { FASTLY_API_TOKEN: TOKEN } })
    assert.equal(list.status, 1, output(list))
    assert.match(output(list), /needs slicc-kernel with @ai-ecoverse\/wasi-fastly's host module/)
    assert.deepEqual(seen, [])
  } finally {
    kernel.terminate()
  }
})
