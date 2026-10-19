import { bounded, HOST, asUser, message, open, output, requests, stream, stub } from './lib/stub.mjs'

export default async function (ctx) {
  const { assert } = ctx
  const ntfy = await asUser(ctx)
  await stub(ctx, [
    stream([open(300), message('m1', 301, 'one'), message('m2', 302, 'two')]),
    stream([open(310), message('m2', 302, 'two'), message('m3', 303, 'three')]),
    stream([open(320), message('m4', 304, 'four')]),
  ])
  const sub = await ntfy(bounded(['ntfy', 'sub', '--since', 'all', `${HOST}/alerts`, 'printf "%s %s\\n" "$NTFY_ID" "$NTFY_MESSAGE"']))
  assert.equal(sub.stdout, 'm1 one\nm2 two\nm3 three\nm4 four\n', output(sub))
  assert.equal(sub.status, 1, output(sub))
  const seen = await requests(ctx)
  assert.deepEqual(seen.map(r => r.url), [
    `${HOST}/alerts/json?since=all`,
    `${HOST}/alerts/json?since=m2`,
    `${HOST}/alerts/json?since=m3`,
    `${HOST}/alerts/json?since=m4`,
  ])
  for (let at = 1; at < seen.length; at++) {
    assert.ok(seen[at].at - seen[at - 1].at >= 9500, `reconnect ${at} after ${seen[at].at - seen[at - 1].at} ms`)
  }

  await stub(ctx, [stream([open(400)]), stream([message('m5', 401, 'five')])])
  const fresh = await ntfy(bounded(['ntfy', 'sub', `${HOST}/alerts`, 'printf "%s\\n" "$NTFY_ID"']))
  assert.equal(fresh.stdout, 'm5\n', output(fresh))
  assert.equal(fresh.status, 1, output(fresh))
  assert.deepEqual((await requests(ctx)).map(r => r.url), [
    `${HOST}/alerts/json`,
    `${HOST}/alerts/json?since=400`,
    `${HOST}/alerts/json?since=m5`,
  ])
}
