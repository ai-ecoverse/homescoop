import { bounded, FORBIDDEN, HOST, UNAUTHORIZED, asUser, open, output, requests, stream, stub, message } from './lib/stub.mjs'

export default async function (ctx) {
  const { assert } = ctx
  const ntfy = await asUser(ctx)

  await stub(ctx, [FORBIDDEN])
  const scoped = await ntfy(['ntfy', 'pub', '--token', 'tk_certhome0subscribeonly0000000', `${HOST}/alerts`, 'hi'])
  assert.notEqual(scoped.status, 0, output(scoped))
  assert.match(scoped.stderr, /forbidden/)
  let seen = await requests(ctx)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].auth, 'Bearer tk_certhome0subscribeonly0000000')

  for (const token of ['', 'tk_forgedforgedforgedforgedforg']) {
    await stub(ctx, [UNAUTHORIZED])
    const argv = token ? ['ntfy', 'pub', '--token', token, `${HOST}/alerts`, 'hi'] : ['ntfy', 'pub', `${HOST}/alerts`, 'hi']
    const refused = await ntfy(argv)
    assert.notEqual(refused.status, 0, output(refused))
    assert.match(refused.stderr, /unauthorized/)
    seen = await requests(ctx)
    assert.equal(seen.length, 1)
    assert.equal(seen[0].auth, token ? `Bearer ${token}` : '')
  }

  await stub(ctx, [UNAUTHORIZED])
  const forged = await ntfy(bounded(['ntfy', 'sub', '--token', 'tk_forgedforgedforgedforgedforg', `${HOST}/alerts`, 'echo ran']))
  assert.equal(forged.status, 1, output(forged))
  assert.match(forged.stderr, /401 Unauthorized/)
  assert.equal(forged.stdout, '')
  assert.equal((await requests(ctx)).length, 1)

  await stub(ctx, [stream([open(100), message('m1', 101, 'before revoke')]), UNAUTHORIZED])
  const revoked = await ntfy(bounded(['ntfy', 'sub', '--token', 'tk_certhome0revokedlater00000000', `${HOST}/alerts`, 'echo "$NTFY_MESSAGE"']))
  assert.equal(revoked.status, 1, output(revoked))
  assert.equal(revoked.stdout, 'before revoke\n')
  assert.match(revoked.stderr, /401 Unauthorized/)
  seen = await requests(ctx)
  assert.deepEqual(seen.map(r => r.url), [`${HOST}/alerts/json`, `${HOST}/alerts/json?since=m1`])
}
