import { HOST, USER, asUser, message, output, requests, stream, stub } from './lib/stub.mjs'

export default async function (ctx) {
  const { assert } = ctx
  const ntfy = await asUser(ctx)
  const tricky = 'deploy $(echo pwned) `echo pwned` ; echo pwned'
  await stub(ctx, [stream([message('c1', 1, tricky)])])
  const script = 'id -un; case "$(env)" in *tk_certhome0secretsecret0000000*) echo leak;; esac; printf "%s\\n" "$NTFY_MESSAGE"'
  const run = await ntfy(['ntfy', 'sub', '--poll', '--token', 'tk_certhome0secretsecret0000000', `${HOST}/alerts`, script])
  assert.equal(run.status, 0, output(run))
  assert.equal(run.stdout, `${USER}\n${tricky}\n`)
  assert.equal((await requests(ctx))[0].auth, 'Bearer tk_certhome0secretsecret0000000')

  await stub(ctx, [stream([message('c2', 2, 'basic')])])
  const basic = await ntfy(['ntfy', 'sub', '--poll', '-u', 'phil:s3cretpw', `${HOST}/alerts`, 'case "$(env)" in *s3cretpw*) echo leak;; esac; printf "%s\\n" "$NTFY_ID"'])
  assert.equal(basic.status, 0, output(basic))
  assert.equal(basic.stdout, 'c2\n')
  assert.equal((await requests(ctx))[0].auth, `Basic ${Buffer.from('phil:s3cretpw').toString('base64')}`)

  await stub(ctx, [stream([message('c3', 3, 'env token')])])
  const fromEnv = await ntfy(['ntfy', 'sub', '--poll', `${HOST}/alerts`, 'printf "%s\\n" "$NTFY_TOKEN"'], { env: { NTFY_TOKEN: 'tk_certhome0fromenvironment0000' } })
  assert.equal(fromEnv.status, 0, output(fromEnv))
  assert.equal(fromEnv.stdout, 'tk_certhome0fromenvironment0000\n')
  assert.equal((await requests(ctx))[0].auth, 'Bearer tk_certhome0fromenvironment0000')
}
