// The config directory: ~/.config/fastly/config.toml (XDG_CONFIG_HOME when
// set), 0600 in a 0700 directory owned by the user, so another user cannot
// read the stored token; the stored token is what the next command sends.
import { HOME, asUser, output, requests, stub } from './lib/stub.mjs'

export default async function (ctx) {
  const { assert } = ctx
  const fastly = await asUser(ctx)
  const other = await asUser(ctx, 'other')
  await stub(ctx, ['stored-token', 'piped-token', 'xdg-token'])

  const add = await fastly(['fastly', 'auth', 'add', 'work', '--api-token', 'stored-token'])
  assert.equal(add.status, 0, output(add))
  const dir = `${HOME}/.config/fastly`
  const config = await ctx.read(`${dir}/config.toml`)
  assert.match(config, /\[auth\.tokens\.work\]/)
  assert.match(config, /token = "stored-token"/)

  const id = await fastly(['id', '-u'])
  assert.equal(id.status, 0, id.stderr)
  const uid = id.stdout.trim()
  const modes = await fastly(['stat', '-c', '%a %u %n', dir, `${dir}/config.toml`])
  assert.equal(modes.status, 0, modes.stderr)
  assert.equal(modes.stdout, `700 ${uid} ${dir}\n600 ${uid} ${dir}/config.toml\n`)
  const peek = await other(['cat', `${dir}/config.toml`])
  assert.notEqual(peek.status, 0, 'another user must not read the stored token')
  assert.doesNotMatch(peek.stdout, /stored-token/)

  // auth add made the default token "work"; the next command sends it, and
  // does not warn about the file's mode.
  await stub(ctx, ['stored-token'])
  const list = await fastly(['fastly', 'service', 'list', '--json'])
  assert.equal(list.status, 0, output(list))
  assert.doesNotMatch(output(list), /Unprotected configuration file/)
  let seen = await requests(ctx)
  assert.equal(seen.length, 1, JSON.stringify(seen))
  assert.equal(seen[0].key, 'stored-token')

  // A failing command line goes to errors.log, --token included: 0600 too.
  await stub(ctx, ['stored-token'])
  const bad = await fastly(['fastly', 'service', 'list', '--token', 'not-a-stored-name'])
  assert.equal(bad.status, 1, output(bad))
  const log = await fastly(['stat', '-c', '%a %u', `${dir}/errors.log`])
  assert.equal(log.status, 0, log.stderr)
  assert.equal(log.stdout, `600 ${uid}\n`)

  // auth login reads a piped token (no terminal to hide it on) and stores it.
  await stub(ctx, ['piped-token'])
  const login = await fastly(['fastly', 'auth', 'login'], { stdin: 'piped-token\n' })
  assert.equal(login.status, 0, output(login))
  assert.match(output(login), /Authenticated as cert@example\.invalid \(token stored as "cert-token"\)/)
  assert.match(await ctx.read(`${dir}/config.toml`), /token = "piped-token"/)
  seen = await requests(ctx)
  assert.ok(seen.every(request => request.key === 'piped-token' && new URL(request.url).hostname === 'api.fastly.com'), JSON.stringify(seen))

  await stub(ctx, ['xdg-token'])
  const xdg = await fastly(['fastly', 'auth', 'add', 'xdg', '--api-token', 'xdg-token'], { env: { XDG_CONFIG_HOME: `${HOME}/xdg` } })
  assert.equal(xdg.status, 0, output(xdg))
  assert.match(await ctx.read(`${HOME}/xdg/fastly/config.toml`), /token = "xdg-token"/)
  const xmodes = await fastly(['stat', '-c', '%a', `${HOME}/xdg/fastly`, `${HOME}/xdg/fastly/config.toml`])
  assert.equal(xmodes.stdout, '700\n600\n')
}
