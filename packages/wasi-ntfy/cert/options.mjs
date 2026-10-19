import { HOME, HOST, asUser, message, output, published, requests, stream, stub } from './lib/stub.mjs'

export default async function (ctx) {
  const { assert, write } = ctx
  const ntfy = await asUser(ctx)

  await stub(ctx, [published('p1', 'basic')])
  const basic = await ntfy(['ntfy', 'pub', '-u', 'phil:s3cret', '-p', 'high', '--tags', 'warning,skull', '--click', 'https://example.test/run/1', `${HOST}/alerts`, 'basic'])
  assert.equal(basic.status, 0, output(basic))
  let seen = await requests(ctx)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].auth, `Basic ${Buffer.from('phil:s3cret').toString('base64')}`)
  assert.equal(seen[0].priority, 'high')
  assert.equal(seen[0].tags, 'warning,skull')
  assert.equal(seen[0].click, 'https://example.test/run/1')
  assert.equal(seen[0].text, 'basic')

  await write(`${HOME}/build.log`, 'line one\nline two\n')
  await stub(ctx, [published('p2', 'log attached')])
  const file = await ntfy(['ntfy', 'pub', '--file', `${HOME}/build.log`, '--title', 'CI', `${HOST}/alerts`, 'log attached'])
  assert.equal(file.status, 0, output(file))
  seen = await requests(ctx)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].filename, 'build.log')
  assert.equal(seen[0].title, 'CI')
  assert.equal(seen[0].text, 'line one\nline two\n')

  await stub(ctx, [published('p3', 'piped')])
  const piped = await ntfy(['bash', '-c', `printf 'from a pipe\\n' | ntfy pub ${HOST}/alerts`])
  assert.equal(piped.status, 0, output(piped))
  seen = await requests(ctx)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].text, 'from a pipe')

  await stub(ctx, [published('p4', 'done')])
  const failed = await ntfy(['ntfy', 'pub', '--wait-cmd', `${HOST}/alerts`, 'sh', '-c', 'exit 3'])
  assert.equal(failed.status, 0, output(failed))
  seen = await requests(ctx)
  assert.equal(seen.length, 1)
  assert.match(seen[0].text, /^Command failed after \d+(\.\d+)?m?s \(exit code 3\): sh -c "exit 3"$/)

  await stub(ctx, [published('p5', 'done')])
  const ok = await ntfy(['ntfy', 'pub', '--wait-cmd', `${HOST}/alerts`, 'true'])
  assert.equal(ok.status, 0, output(ok))
  seen = await requests(ctx)
  assert.equal(seen.length, 1)
  assert.match(seen[0].text, /^Command succeeded after \d+(\.\d+)?m?s: true$/)

  await write(`${HOME}/.config/ntfy/client.yml`, [
    `default-host: ${HOST}`,
    'default-token: tk_certhome0fromconfig000000000',
    'subscribe:',
    '  - topic: builds',
    '    command: \'printf "builds %s\\n" "$NTFY_ID"\'',
    '  - topic: deploys',
    '    token: tk_certhome0deploysonly000000000',
    '    command: \'printf "deploys %s\\n" "$NTFY_ID"\'',
    '',
  ].join('\n'))
  await stub(ctx, [stream([message('b1', 1, 'build', { topic: 'builds' })]), stream([message('d1', 2, 'deploy', { topic: 'deploys' })])])
  const fromConfig = await ntfy(['ntfy', 'sub', '--from-config', '--poll'])
  assert.equal(fromConfig.status, 0, output(fromConfig))
  assert.equal(fromConfig.stdout, 'builds b1\ndeploys d1\n')
  seen = await requests(ctx)
  assert.deepEqual(seen.map(r => [r.url, r.auth]), [
    [`${HOST}/builds/json?poll=1`, 'Bearer tk_certhome0fromconfig000000000'],
    [`${HOST}/deploys/json?poll=1`, 'Bearer tk_certhome0deploysonly000000000'],
  ])
  await write(`${HOME}/.config/ntfy/client.yml`, '')
}
