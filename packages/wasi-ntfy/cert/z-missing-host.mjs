import { HOST, asUser, output, published, requests, stub } from './lib/stub.mjs'

const STUB = `export function createImports () {
  return { ntfy_host: { probe: () => 0, call: () => 0, take: () => {} } }
}
`

export default async function (ctx) {
  const { assert, write } = ctx
  const ntfy = await asUser(ctx)
  await write('node_modules/@ai-ecoverse/wasi-ntfy/host/ntfy-host.mjs', STUB)
  await stub(ctx, [published('p1', 'hi')])
  const result = await ntfy(['ntfy', 'pub', `${HOST}/alerts`, 'hi'])
  assert.notEqual(result.status, 0)
  assert.match(output(result), /needs slicc-kernel with @ai-ecoverse\/wasi-ntfy's host module/)
  assert.equal((await requests(ctx)).length, 0)
}
