// fastly version and --help offline, then API calls with FASTLY_API_TOKEN
// through the kernel's network (ctx.serve): the transport sees each
// request, Fastly-Key included, and nothing else.
import { SERVICE_ID, TOKEN, asUser, output, requests, stub } from './lib/stub.mjs'

export default async function (ctx) {
  const { assert } = ctx
  const fastly = await asUser(ctx)
  await stub(ctx)

  const version = await fastly(['fastly', 'version'])
  assert.equal(version.status, 0, output(version))
  assert.match(version.stdout, /^Fastly CLI version v17\.1\.0 \(3e9473d\)\nBuilt with go version go1\.\d+\.\d+ wasip1\/wasm \(\d{4}-\d\d-\d\d\)\n$/)

  const help = await fastly(['fastly', '--help'])
  assert.equal(help.status, 0, output(help))
  assert.match(output(help), /A tool to interact with the Fastly API/)
  assert.match(output(help), /^ {2}service +Manipulate Fastly services/m)
  assert.deepEqual(await requests(ctx), [], 'version and --help make no request')

  const env = { FASTLY_API_TOKEN: TOKEN }
  const list = await fastly(['fastly', 'service', 'list', '--json'], { env })
  assert.equal(list.status, 0, output(list))
  const services = JSON.parse(list.stdout)
  assert.equal(services.length, 1)
  assert.equal(services[0].ServiceID, SERVICE_ID)
  assert.equal(services[0].Name, `cert-service for ${TOKEN}`)
  // One request, the command's own: no OpenID Connect metadata first (0004),
  // no update check after (0003).
  let seen = await requests(ctx)
  assert.equal(seen.length, 1, JSON.stringify(seen))
  assert.equal(seen[0].method, 'GET')
  assert.match(seen[0].url, /^https:\/\/api\.fastly\.com\/service(\?|$)/)
  assert.equal(seen[0].key, TOKEN)
  assert.match(seen[0].agent, /^FastlyCLI\/v17\.1\.0, FastlyGo\//)

  const table = await fastly(['fastly', 'service', 'list'], { env })
  assert.equal(table.status, 0, output(table))
  assert.match(table.stdout, /cert-service for sealed-placeholder/)
  assert.doesNotMatch(output(table), /A new version of the Fastly CLI is available/)

  await stub(ctx)
  const created = await fastly(['fastly', 'service', 'create', '--name', 'cert-new', '--type', 'wasm'], { env })
  assert.equal(created.status, 0, output(created))
  assert.match(created.stdout, /Created service NEWSERVICE0000000000a/)
  seen = await requests(ctx)
  assert.equal(seen.length, 1, JSON.stringify(seen))
  assert.equal(seen[0].method, 'POST')
  assert.equal(seen[0].url, 'https://api.fastly.com/service')
  assert.equal(seen[0].key, TOKEN)
  const form = new URLSearchParams(seen[0].body)
  assert.equal(form.get('name'), 'cert-new')
  assert.equal(form.get('type'), 'wasm')

  // A token the API refuses is an error, not a hang or a retry loop.
  await stub(ctx)
  const refused = await fastly(['fastly', 'service', 'list'], { env: { FASTLY_API_TOKEN: 'revoked' } })
  assert.equal(refused.status, 1, output(refused))
  assert.match(output(refused), /401/)
  assert.equal((await requests(ctx)).length, 1)
}
