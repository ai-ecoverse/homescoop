import { HOST, HOME, asUser, message, output, published, requests, stream, stub, json } from './lib/stub.mjs'

export default async function (ctx) {
  const { assert, write } = ctx
  const ntfy = await asUser(ctx)

  const version = await ntfy(['ntfy', '--version'])
  assert.equal(version.status, 0, output(version))
  assert.match(version.stdout, /^ntfy version 2\.32\.0\b/)

  await stub(ctx, [published('p1', 'disk full')])
  const pub = await ntfy(['ntfy', 'pub', '--token', 'tk_certhome0publishonly00000000', '--title', 'Backups', `${HOST}/alerts`, 'disk', 'full'])
  assert.equal(pub.status, 0, output(pub))
  assert.equal(JSON.parse(pub.stdout).id, 'p1')
  let seen = await requests(ctx)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].method, 'POST')
  assert.equal(seen[0].url, `${HOST}/alerts`)
  assert.equal(seen[0].auth, 'Bearer tk_certhome0publishonly00000000')
  assert.equal(seen[0].title, 'Backups')
  assert.equal(seen[0].text, 'disk full')

  await write(`${HOME}/.config/ntfy/client.yml`, `default-host: ${HOST}\ndefault-token: tk_certhome0fromconfig000000000\n`)
  await stub(ctx, [published('p2', 'from config')])
  const configured = await ntfy(['ntfy', 'pub', 'alerts', 'from', 'config'])
  assert.equal(configured.status, 0, output(configured))
  seen = await requests(ctx)
  assert.equal(seen[0].url, `${HOST}/alerts`)
  assert.equal(seen[0].auth, 'Bearer tk_certhome0fromconfig000000000')

  const raw = message('m2', 102, 'second', { title: 'pull_request', attachment: { name: 'body.json', type: 'application/json', size: 70000, url: `${HOST}/file/abc.json` } })
  await stub(ctx, [stream([message('m1', 101, 'first', { title: 'push' }), raw])])
  const poll = await ntfy(['ntfy', 'sub', '--poll', '--since', 'all', 'alerts'])
  assert.equal(poll.status, 0, output(poll))
  assert.deepEqual(poll.stdout.trim().split('\n').map(text => JSON.parse(text).id), ['m1', 'm2'])
  seen = await requests(ctx)
  assert.equal(seen[0].url, `${HOST}/alerts/json?poll=1&since=all`)
  assert.equal(seen[0].auth, 'Bearer tk_certhome0fromconfig000000000')

  const big = 'y'.repeat(60 * 1024)
  await stub(ctx, [stream([message('m1', 101, 'first', { title: 'push' }), raw, message('m3', 103, big)])])
  const script = [
    'printf "%s|%s|%s|%s\\n" "$NTFY_ID" "$NTFY_TITLE" "${#NTFY_MESSAGE}" "$NTFY_TOPIC"',
    `case "$NTFY_RAW" in *'"url":"${HOST}/file/abc.json"'*) echo attachment;; esac`,
  ].join('; ')
  const each = await ntfy(['ntfy', 'sub', '--poll', '--since', 'all', 'alerts', script])
  assert.equal(each.status, 0, output(each))
  assert.equal(each.stdout, `m1|push|5|cert\nm2|pull_request|6|cert\nattachment\nm3||${big.length}|cert\n`)

  await stub(ctx, [json(200, message('p3', 1, 'x'))])
  const waitPid = await ntfy(['ntfy', 'pub', '--wait-pid', '1', 'alerts', 'done'])
  assert.notEqual(waitPid.status, 0)
  assert.match(output(waitPid), /--wait-pid is not available on wasip1/)
  assert.equal((await requests(ctx)).length, 0)

  await write(`${HOME}/.config/ntfy/client.yml`, '')
}
