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
}
