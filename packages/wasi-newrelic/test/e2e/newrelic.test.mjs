// End-to-end: newrelic.wasm and host/newrelic-host.mjs on slicc-kernel's
// headless Node entry, with a network transport that records every request
// and answers for api.newrelic.com (NerdGraph) itself. Nothing leaves the
// machine.
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { attachKernel, createNodeKernel } from '@ai-ecoverse/slicc-kernel/node'

const PACKAGE = fileURLToPath(new URL('../../package/', import.meta.url))
const HOME = '/home/app'
const KEY = 'NRAK-SEALEDPLACEHOLDER000000000'
const QUERY = '{ actor { user { name } } }'

function recorder (keys = [KEY]) {
  const seen = []
  const json = (status, value) => ({ status, statusText: status === 200 ? 'OK' : 'Error', headers: [['content-type', 'application/json']], body: JSON.stringify(value) })
  const answer = request => {
    const url = new URL(request.url)
    const pairs = Array.isArray(request.headers) ? request.headers : Object.entries(request.headers ?? {})
    const header = name => pairs.find(([key]) => key.toLowerCase() === name)?.[1] ?? ''
    const body = request.body ? new TextDecoder().decode(request.body) : ''
    seen.push({ method: request.method, url: request.url, key: header('api-key'), agent: header('user-agent'), body })
    if (url.hostname !== 'api.newrelic.com' && url.hostname !== 'api.eu.newrelic.com') return json(503, { message: `not reachable in this test: ${url.hostname}` })
    if (!keys.includes(header('api-key'))) return json(401, { errors: [{ message: 'authentication required' }] })
    if (url.pathname === '/graphql') {
      const query = JSON.parse(body).query
      if (/actor\s*{\s*user\s*{\s*name\s*}\s*}/.test(query)) return json(200, { data: { actor: { user: { name: `Cert User via ${url.hostname}` } } } })
      return json(200, { errors: [{ message: `no answer for ${query} in this test` }] })
    }
    return json(404, { message: `no ${url.pathname}` })
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
      delete manifest.slicc.commands.newrelic.imports
      data = Buffer.from(JSON.stringify(manifest))
    }
    await kernel.writeFile(`/node_modules/@ai-ecoverse/wasi-newrelic/${name}`, data)
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
  kernel.run(['newrelic', ...argv], { cwd: HOME, env: { HOME, ...env }, ...(stdin === undefined ? {} : { stdin }) })

test('newrelic version and --help run without the network', async () => {
  const { kernel, seen } = await kernelWith()
  try {
    const version = await run(kernel, ['version'])
    assert.equal(version.status, 0, output(version))
    assert.equal(version.stdout, 'newrelic version 0.117.0\n')
    const help = await run(kernel, ['--help'])
    assert.equal(help.status, 0, output(help))
    assert.match(help.stdout, /^Usage:\n {2}newrelic \[command\]$/m)
    assert.match(help.stdout, /^ {2}nerdgraph +Execute GraphQL requests to the NerdGraph API$/m)
    assert.deepEqual(seen, [])
  } finally {
    kernel.terminate()
  }
})

for (const blocking of ['sync', 'async']) {
  test(`NEW_RELIC_API_KEY reaches api.newrelic.com/graphql as Api-Key, in one request (${blocking} host)`, async () => {
    const { kernel, seen } = await kernelWith({ blocking })
    try {
      const query = await run(kernel, ['nerdgraph', 'query', QUERY], { env: { NEW_RELIC_API_KEY: KEY } })
      assert.equal(query.status, 0, output(query))
      assert.deepEqual(JSON.parse(query.stdout), { actor: { user: { name: 'Cert User via api.newrelic.com' } } })
      assert.equal(seen.length, 1, JSON.stringify(seen))
      assert.equal(seen[0].method, 'POST')
      assert.equal(seen[0].url, 'https://api.newrelic.com/graphql')
      assert.equal(seen[0].key, KEY)
      assert.equal(seen[0].agent, 'newrelic-cli/0.117.0 (https://github.com/newrelic/newrelic-cli)')
      assert.equal(JSON.parse(seen[0].body).query, QUERY)
    } finally {
      kernel.terminate()
    }
  })
}

test('a key NerdGraph refuses exits 1 after one request, with the 401', async () => {
  const { kernel, seen } = await kernelWith()
  try {
    const refused = await run(kernel, ['nerdgraph', 'query', QUERY], { env: { NEW_RELIC_API_KEY: 'NRAK-REVOKED' } })
    assert.equal(refused.status, 1, output(refused))
    assert.match(output(refused), /401 response returned/)
    assert.equal(seen.length, 1, JSON.stringify(seen))
  } finally {
    kernel.terminate()
  }
})

test('NEW_RELIC_REGION=EU goes to api.eu.newrelic.com', async () => {
  const { kernel, seen } = await kernelWith()
  try {
    const query = await run(kernel, ['nerdgraph', 'query', QUERY], { env: { NEW_RELIC_API_KEY: KEY, NEW_RELIC_REGION: 'EU' } })
    assert.equal(query.status, 0, output(query))
    assert.deepEqual(JSON.parse(query.stdout), { actor: { user: { name: 'Cert User via api.eu.newrelic.com' } } })
    assert.deepEqual(seen.map(request => request.url), ['https://api.eu.newrelic.com/graphql'])
  } finally {
    kernel.terminate()
  }
})

test('profile add stores the key in ~/.newrelic/credentials.json, 0600 in a 0700 directory, and the next command sends it', async () => {
  const { kernel, seen } = await kernelWith()
  try {
    const add = await run(kernel, ['profile', 'add', '--profile', 'work', '--apiKey', KEY, '--region', 'US', '--accountId', '12345', '--licenseKey', 'LICENSE-PLACEHOLDER', '-y'])
    assert.equal(add.status, 0, output(add))
    const credentials = JSON.parse(new TextDecoder().decode(await kernel.readFile(`${HOME}/.newrelic/credentials.json`)))
    assert.equal(credentials.work.apiKey, KEY)
    assert.equal(credentials.work.accountID, 12345)
    const client = await attachKernel(await kernel.connect())
    try {
      assert.equal((await client.fs.stat(`${HOME}/.newrelic`)).mode & 0o777, 0o700)
      assert.equal((await client.fs.stat(`${HOME}/.newrelic/credentials.json`)).mode & 0o777, 0o600)
    } finally {
      client.detach?.()
    }
    assert.deepEqual(seen, [], 'every value was given, so profile add asks nothing')
    const query = await run(kernel, ['nerdgraph', 'query', QUERY])
    assert.equal(query.status, 0, output(query))
    assert.equal(seen.length, 1, JSON.stringify(seen))
    assert.equal(seen[0].key, KEY)
  } finally {
    kernel.terminate()
  }
})

test('a value left to a prompt fails at once with the reason, since wasip1 has no raw terminal mode', async () => {
  const { kernel } = await kernelWith()
  try {
    // No --accountId and no -y: upstream would prompt for the account ID.
    const add = await run(kernel, ['profile', 'add', '--profile', 'work', '--apiKey', KEY, '--region', 'US', '--licenseKey', 'LICENSE-PLACEHOLDER'])
    assert.equal(add.status, 1, output(add))
    assert.match(output(add), /cannot prompt: WASI preview1 has no terminal raw mode; pass the value as a flag/)
    // No question written, no cursor query sent to the terminal.
    assert.doesNotMatch(output(add), /Account ID|\x1b\[6n/)
  } finally {
    kernel.terminate()
  }
})

test('install and diagnose run/update/lint refuse with their reason and make no request', async () => {
  const { kernel, seen } = await kernelWith()
  try {
    for (const [argv, message] of [
      [['install'], /newrelic install is not available in this build: it runs install recipes/],
      [['install', '-n', 'infrastructure-agent-installer', '-y'], /newrelic install is not available in this build/],
      [['diagnose', 'run'], /newrelic diagnose run, update and lint are not available in this build/],
      [['diagnose', 'update'], /newrelic diagnose run, update and lint are not available in this build/],
      [['diagnose', 'lint', '--config-file', 'newrelic.yml'], /newrelic diagnose run, update and lint are not available in this build/],
    ]) {
      const result = await run(kernel, argv, { env: { NEW_RELIC_API_KEY: KEY } })
      assert.equal(result.status, 1, `newrelic ${argv.join(' ')}: ${output(result)}`)
      assert.match(output(result), message, `newrelic ${argv.join(' ')}`)
    }
    assert.deepEqual(seen, [])
    const help = await run(kernel, ['install', '--help'])
    assert.equal(help.status, 0, output(help))
    assert.match(help.stdout, /Install New Relic\./)
  } finally {
    kernel.terminate()
  }
})

test('without the host module, NerdGraph calls report that the runtime cannot open a connection', async () => {
  const { kernel, seen } = await kernelWith({ hostModule: false })
  try {
    const version = await run(kernel, ['version'])
    assert.equal(version.status, 0, output(version))
    const query = await run(kernel, ['nerdgraph', 'query', QUERY], { env: { NEW_RELIC_API_KEY: KEY } })
    assert.equal(query.status, 1, output(query))
    assert.match(output(query), /needs slicc-kernel with @ai-ecoverse\/wasi-newrelic's host module/)
    assert.deepEqual(seen, [])
  } finally {
    kernel.terminate()
  }
})
