import { TOKEN, asUser, output, requests, stub } from './lib/stub.mjs'
import { recipeVersion } from './lib/version.mjs'

const RECV = 'set req.http.X-Cert = "1";\n'

export default async function (ctx) {
  const { assert, write } = ctx
  const fastly = await asUser(ctx, 'edge')
  const home = '/home/edge'
  const dir = `${home}/.config/fastly`
  await write(`${home}/recv.vcl`, RECV)
  const env = { FASTLY_API_TOKEN: TOKEN }

  await stub(ctx)
  const first = await fastly(['fastly', 'vcl', 'check', 'recv.vcl'], { env })
  assert.equal(first.status, 0, output(first))
  assert.match(output(first), /VCL compiled cleanly\./)
  let seen = await requests(ctx)
  assert.equal(seen.length, 1, JSON.stringify(seen))
  assert.equal(seen[0].method, 'POST')
  assert.equal(seen[0].url, 'https://fiddle.fastly.dev/fiddle')
  assert.equal(seen[0].key, '')
  assert.equal(seen[0].auth, '')
  assert.equal(seen[0].agent, `FastlyCLI/v${recipeVersion()}`)
  assert.ok(!seen[0].body.includes(TOKEN), seen[0].body)
  const spec = JSON.parse(seen[0].body)
  assert.deepEqual(spec.vcl, { recv: RECV })
  assert.deepEqual(spec.origins, ['https://http-me.fastly.dev'])

  const state = await ctx.read(`${dir}/vcl-sandbox.json`)
  assert.deepEqual(JSON.parse(state), { id: 'cert-fiddle', cache_id: 0 })
  assert.ok(!state.includes(TOKEN), state)
  const id = await fastly(['id', '-u'])
  assert.equal(id.status, 0, id.stderr)
  const modes = await fastly(['stat', '-c', '%a %u', dir])
  assert.equal(modes.status, 0, modes.stderr)
  assert.equal(modes.stdout, `700 ${id.stdout.trim()}\n`)

  await stub(ctx)
  const again = await fastly(['fastly', 'vcl', 'check', 'recv.vcl'], { env })
  assert.equal(again.status, 0, output(again))
  seen = await requests(ctx)
  assert.equal(seen.length, 1, JSON.stringify(seen))
  assert.equal(seen[0].method, 'PUT')
  assert.equal(seen[0].url, 'https://fiddle.fastly.dev/fiddle/cert-fiddle')
  assert.equal(seen[0].key, '')
  assert.equal(seen[0].auth, '')

  await write(`${home}/recv.vcl`, 'set req.http.X-Cert = "1";\nset req.http.X-Bad = req.http.nope;\n')
  await stub(ctx)
  const broken = await fastly(['fastly', 'vcl', 'check', 'recv.vcl'], { env })
  assert.equal(broken.status, 1, output(broken))
  assert.match(output(broken), /^recv\.vcl:2: error: Unknown variable: req\.http\.nope$/m)
  assert.match(output(broken), /the VCL failed to compile/)
  seen = await requests(ctx)
  assert.equal(seen.length, 1, JSON.stringify(seen))
  assert.equal(seen[0].key, '')

  await write(`${home}/recv.vcl`, RECV)
  await stub(ctx)
  const run = await fastly(['fastly', 'vcl', 'run', 'recv.vcl'], { env })
  assert.equal(run.status, 0, output(run))
  assert.match(output(run), /^GET \/ → 200 \(text\/plain, 24 bytes, MISS\)$/m)
  assert.match(output(run), /^hello from the cert edge$/m)
  seen = await requests(ctx)
  assert.deepEqual(seen.map(request => `${request.method} ${new URL(request.url).origin}${new URL(request.url).pathname}`), [
    'PUT https://fiddle.fastly.dev/fiddle/cert-fiddle',
    'POST https://fiddle.fastly.dev/fiddle/cert-fiddle/execute',
    'GET https://fiddle.fastly.dev/results/cert-session/stream',
  ])
  for (const request of seen) {
    assert.equal(request.key, '', request.url)
    assert.equal(request.auth, '', request.url)
    assert.ok(!request.body.includes(TOKEN), request.url)
  }
  const sent = JSON.parse(seen[0].body)
  assert.equal(sent.requests.length, 1)
  assert.equal(sent.requests[0].method, 'GET')
  assert.equal(sent.requests[0].path, '/')
  const cacheID = Number(new URL(seen[1].url).searchParams.get('cacheID'))
  assert.ok(cacheID > 0, seen[1].url)
  assert.deepEqual(JSON.parse(await ctx.read(`${dir}/vcl-sandbox.json`)), { id: 'cert-fiddle', cache_id: cacheID })
}
