import { bounded, HOME, HOST, asUser, json, message, open, output, published, requests, stream, stub } from './lib/stub.mjs'

const limited = seconds => json(429, { code: 42901, http: 429, error: 'limit reached: too many requests' }, [['retry-after', String(seconds)]])

export default async function (ctx) {
  const { assert, write } = ctx
  const ntfy = await asUser(ctx)

  await stub(ctx, [limited(3), published('p1', 'after the wait')])
  const pub = await ntfy(['ntfy', 'pub', '--token', 'tk_certhome0publishonly00000000', `${HOST}/alerts`, 'after', 'the', 'wait'])
  assert.equal(pub.status, 0, output(pub))
  assert.equal(JSON.parse(pub.stdout).id, 'p1')
  let seen = await requests(ctx)
  assert.equal(seen.length, 2, JSON.stringify(seen))
  assert.ok(seen[1].at - seen[0].at >= 2900, `retried after ${seen[1].at - seen[0].at} ms, retry-after was 3 s`)
  assert.equal(seen[1].text, 'after the wait')

  await write(`${HOME}/report.txt`, 'attached report\n')
  await stub(ctx, [limited(2), published('p2', 'report')])
  const file = await ntfy(['ntfy', 'pub', '--file', `${HOME}/report.txt`, `${HOST}/alerts`])
  assert.equal(file.status, 0, output(file))
  seen = await requests(ctx)
  assert.equal(seen.length, 2, JSON.stringify(seen))
  assert.ok(seen[1].at - seen[0].at >= 1900, `retried after ${seen[1].at - seen[0].at} ms, retry-after was 2 s`)
  assert.deepEqual(seen.map(r => r.text), ['attached report\n', 'attached report\n'])

  await stub(ctx, [limited(600)])
  const tooLong = await ntfy(['ntfy', 'pub', `${HOST}/alerts`, 'hi'])
  assert.notEqual(tooLong.status, 0, output(tooLong))
  assert.match(tooLong.stderr, /retry after 10m0s/)
  assert.equal((await requests(ctx)).length, 1)

  await stub(ctx, [limited(14), stream([open(200), message('m1', 201, 'after the limit')])])
  const sub = await ntfy(bounded(['ntfy', 'sub', `${HOST}/alerts`, 'echo "$NTFY_MESSAGE"']))
  assert.equal(sub.status, 1, output(sub))
  assert.equal(sub.stdout, 'after the limit\n')
  seen = await requests(ctx)
  assert.equal(seen.length, 3, JSON.stringify(seen.map(r => r.url)))
  assert.ok(seen[1].at - seen[0].at >= 13900, `reconnected after ${seen[1].at - seen[0].at} ms, retry-after was 14 s`)
  assert.equal(seen[1].url, `${HOST}/alerts/json`)
}
