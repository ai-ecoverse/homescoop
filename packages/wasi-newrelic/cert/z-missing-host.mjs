// Last spec on purpose: it replaces the host module for the rest of the boot.
// newrelic.wasm imports newrelic_host, and a probe other than 0x6e72636c is
// the missing module. The kernel reads this file again on the next launch.
import { KEY, QUERY, asUser, output, requests, stub } from './lib/stub.mjs'

const STUB = `export function createImports () {
  return { newrelic_host: { probe: () => 0, call: () => 0, take: () => {} } }
}
`

export default async function (ctx) {
  const { assert, write } = ctx
  const newrelic = await asUser(ctx, 'nohost')
  await stub(ctx)
  await write('node_modules/@ai-ecoverse/wasi-newrelic/host/newrelic-host.mjs', STUB)
  const version = await newrelic(['newrelic', 'version'])
  assert.equal(version.status, 0, output(version))
  const result = await newrelic(['newrelic', 'nerdgraph', 'query', QUERY], { env: { NEW_RELIC_API_KEY: KEY } })
  assert.equal(result.status, 1, output(result))
  assert.match(output(result), /needs slicc-kernel with @ai-ecoverse\/wasi-newrelic's host module/)
  assert.deepEqual(await requests(ctx), [])
}
