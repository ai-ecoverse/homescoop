// ~/.newrelic: profile add stores the keys in credentials.json, 0600 in a
// 0700 directory owned by the user, so another user cannot read them; the
// stored key is what the next command sends. A value left to a prompt fails
// at once with the reason (wasip1 has no terminal raw mode).
import { HOME, KEY, QUERY, asUser, output, requests, stub } from './lib/stub.mjs'

export default async function (ctx) {
  const { assert } = ctx
  const newrelic = await asUser(ctx)
  const other = await asUser(ctx, 'other')
  await stub(ctx)

  const add = await newrelic(['newrelic', 'profile', 'add', '--profile', 'work', '--apiKey', KEY, '--region', 'US', '--accountId', '12345', '--licenseKey', 'LICENSE-PLACEHOLDER', '-y'])
  assert.equal(add.status, 0, output(add))
  const dir = `${HOME}/.newrelic`
  const credentials = JSON.parse(await ctx.read(`${dir}/credentials.json`))
  assert.equal(credentials.work.apiKey, KEY)
  assert.equal(credentials.work.licenseKey, 'LICENSE-PLACEHOLDER')
  assert.deepEqual(await requests(ctx), [], 'every value was a flag, so profile add asks nothing')

  const id = await newrelic(['id', '-u'])
  assert.equal(id.status, 0, id.stderr)
  const uid = id.stdout.trim()
  const modes = await newrelic(['stat', '-c', '%a %u %n', dir, `${dir}/credentials.json`])
  assert.equal(modes.status, 0, modes.stderr)
  assert.equal(modes.stdout, `700 ${uid} ${dir}\n600 ${uid} ${dir}/credentials.json\n`)
  const peek = await other(['cat', `${dir}/credentials.json`])
  assert.notEqual(peek.status, 0, 'another user must not read the stored keys')
  assert.doesNotMatch(peek.stdout, /NRAK-/)

  // The first profile became the default; the next command sends its key.
  const list = await newrelic(['newrelic', 'profile', 'list'])
  assert.equal(list.status, 0, output(list))
  // The table colours the default marker; compare it without escapes.
  assert.match(list.stdout.replace(/\x1b\[[0-9;]*m/g, ''), /^work \(default\) 12345 /m)
  await stub(ctx)
  const query = await newrelic(['newrelic', 'nerdgraph', 'query', QUERY])
  assert.equal(query.status, 0, output(query))
  const seen = await requests(ctx)
  assert.equal(seen.length, 1, JSON.stringify(seen))
  assert.equal(seen[0].key, KEY)

  // config.json (newrelic config set) is written the same way.
  const set = await newrelic(['newrelic', 'config', 'set', '--key', 'logLevel', '--value', 'debug'])
  assert.equal(set.status, 0, output(set))
  const cmode = await newrelic(['stat', '-c', '%a', `${dir}/config.json`])
  assert.equal(cmode.stdout, '600\n')

  // No --accountId and no -y: upstream prompts. Here it fails at once,
  // without writing the question or a cursor query to the terminal.
  await stub(ctx)
  const prompt = await newrelic(['newrelic', 'profile', 'add', '--profile', 'second', '--apiKey', KEY, '--region', 'US', '--licenseKey', 'LICENSE-PLACEHOLDER'])
  assert.equal(prompt.status, 1, output(prompt))
  assert.match(output(prompt), /cannot prompt: WASI preview1 has no terminal raw mode; pass the value as a flag/)
  assert.doesNotMatch(output(prompt), /Account ID|\x1b\[6n/)
}
