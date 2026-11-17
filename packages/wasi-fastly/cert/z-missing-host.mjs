// Last spec on purpose: it replaces the host module for the rest of the boot.
// fastly.wasm imports fastly_host, and a probe other than 0x66736c79 is the
// missing module. The kernel reads this file again on the next launch.
import { TOKEN, asUser, output, requests, stub } from './lib/stub.mjs'

const STUB = `export function createImports () {
  return { fastly_host: { probe: () => 0, call: () => 0, take: () => {} } }
}
`

export default async function (ctx) {
  const { assert, write } = ctx
  const fastly = await asUser(ctx, 'nohost')
  await stub(ctx)
  await write('node_modules/@ai-ecoverse/wasi-fastly/host/fastly-host.mjs', STUB)
  const version = await fastly(['fastly', 'version'])
  assert.equal(version.status, 0, output(version))
  const result = await fastly(['fastly', 'service', 'list'], { env: { FASTLY_API_TOKEN: TOKEN } })
  assert.equal(result.status, 1, output(result))
  assert.match(output(result), /needs slicc-kernel with @ai-ecoverse\/wasi-fastly's host module/)
  assert.deepEqual(await requests(ctx), [])
}
