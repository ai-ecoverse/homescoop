// newrelic version and --help offline, then NerdGraph calls with
// NEW_RELIC_API_KEY through the kernel's network (ctx.serve): the transport
// sees each request, Api-Key included, and nothing else.
import { KEY, QUERY, asUser, output, requests, stub } from './lib/stub.mjs'

export default async function (ctx) {
  const { assert } = ctx
  const newrelic = await asUser(ctx)
  await stub(ctx)

  const version = await newrelic(['newrelic', 'version'])
  assert.equal(version.status, 0, output(version))
  assert.equal(version.stdout, 'newrelic version 0.117.0\n')

  const help = await newrelic(['newrelic', '--help'])
  assert.equal(help.status, 0, output(help))
  assert.match(help.stdout, /The New Relic CLI enables users to perform tasks against the New Relic APIs/)
  assert.match(help.stdout, /^Usage:\n {2}newrelic \[command\]$/m)
  assert.match(help.stdout, /^ {2}nerdgraph +Execute GraphQL requests to the NerdGraph API$/m)
  assert.deepEqual(await requests(ctx), [], 'version and --help make no request')

  // Without a key the CLI stops before any request.
  const nokey = await newrelic(['newrelic', 'nerdgraph', 'query', QUERY])
  assert.equal(nokey.status, 1, output(nokey))
  assert.match(output(nokey), /could not initialize New Relic client/)
  assert.deepEqual(await requests(ctx), [])

  const env = { NEW_RELIC_API_KEY: KEY }
  const query = await newrelic(['newrelic', 'nerdgraph', 'query', QUERY], { env })
  assert.equal(query.status, 0, output(query))
  assert.deepEqual(JSON.parse(query.stdout), { actor: { user: { name: 'Cert User via api.newrelic.com' } } })
  let seen = await requests(ctx)
  assert.equal(seen.length, 1, JSON.stringify(seen))
  assert.equal(seen[0].method, 'POST')
  assert.equal(seen[0].url, 'https://api.newrelic.com/graphql')
  assert.equal(seen[0].key, KEY)
  assert.equal(seen[0].agent, 'newrelic-cli/0.117.0 (https://github.com/newrelic/newrelic-cli)')
  assert.equal(JSON.parse(seen[0].body).query, QUERY)

  // nrql query is NerdGraph too.
  await stub(ctx)
  const nrql = await newrelic(['newrelic', 'nrql', 'query', '--accountId', '12345', '--query', 'SELECT count(*) FROM Transaction'], { env })
  assert.equal(nrql.status, 0, output(nrql))
  assert.deepEqual(JSON.parse(nrql.stdout), [{ count: 42 }])
  seen = await requests(ctx)
  assert.equal(seen.length, 1, JSON.stringify(seen))
  const sent = JSON.parse(seen[0].body)
  assert.match(sent.query, /nrql\(query: \$query\)/)
  assert.equal(sent.variables.query, 'SELECT count(*) FROM Transaction')
  assert.equal(sent.variables.accountId, 12345)

  // The EU region goes to api.eu.newrelic.com.
  await stub(ctx)
  const eu = await newrelic(['newrelic', 'nerdgraph', 'query', QUERY], { env: { ...env, NEW_RELIC_REGION: 'EU' } })
  assert.equal(eu.status, 0, output(eu))
  assert.deepEqual((await requests(ctx)).map(request => request.url), ['https://api.eu.newrelic.com/graphql'])

  // A key NerdGraph refuses is an error after one request, not a hang or a
  // retry loop.
  await stub(ctx)
  const refused = await newrelic(['newrelic', 'nerdgraph', 'query', QUERY], { env: { NEW_RELIC_API_KEY: 'NRAK-REVOKED' } })
  assert.equal(refused.status, 1, output(refused))
  assert.match(output(refused), /401 response returned/)
  assert.equal((await requests(ctx)).length, 1)
}
