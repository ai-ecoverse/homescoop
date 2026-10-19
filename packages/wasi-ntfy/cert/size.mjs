import { HOST, asUser, output, published, requests, stub } from './lib/stub.mjs'

const MiB = 1024 * 1024

export default async function (ctx) {
  const { assert } = ctx
  const ntfy = await asUser(ctx)

  await stub(ctx, [published('p1', 'big')])
  const over = await ntfy(['ntfy', 'pub', `${HOST}/alerts`], { stdin: 'z'.repeat(MiB + 1) })
  assert.notEqual(over.status, 0, output(over))
  assert.match(over.stderr, /message is over the 1 MiB limit \(1048576 bytes\); send it as an attachment with --file instead/)
  assert.equal((await requests(ctx)).length, 0)

  await stub(ctx, [published('p2', 'big')])
  const flag = await ntfy(['ntfy', 'pub', '--message', 'm'.repeat(MiB + 10), `${HOST}/alerts`])
  assert.notEqual(flag.status, 0, output(flag))
  assert.match(flag.stderr, /over the 1 MiB limit/)
  assert.equal((await requests(ctx)).length, 0)

  await stub(ctx, [published('p3', 'at the limit')])
  const at = await ntfy(['ntfy', 'pub', `${HOST}/alerts`], { stdin: 'a'.repeat(MiB) })
  assert.equal(at.status, 0, output(at))
  const seen = await requests(ctx)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].length, MiB)
}
