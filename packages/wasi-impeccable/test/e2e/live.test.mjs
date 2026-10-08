// End-to-end: live mode inside the kernel, on the published slicc-kernel's
// headless Node entry. `impeccable live` starts the live server detached (a
// second kernel process, threads per connection) on the kernel's loopback.
// curl, another kernel process, plays the page: it reads the SSE stream and
// POSTs a browser event, which the agent's `live-poll` receives.
// The browser page itself cannot reach kernel loopback yet (slicc-kernel#103,
// slicc-bios#92).
// Run with --test-force-exit until slicc-kernel#110 ships: the server's
// sleeping threads leave kernel timers armed after it exits, which keeps Node
// alive (https://github.com/ai-ecoverse/slicc-kernel/issues/110).
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createNodeKernel } from '@ai-ecoverse/slicc-kernel/node'

const here = path => fileURLToPath(new URL(path, import.meta.url))
const PACKAGES = {
  '@ai-ecoverse/wasi-impeccable': process.env.WASI_IMPECCABLE_PACKAGE ?? here('../../package/'),
  '@ai-ecoverse/wasm-curl': here('../node_modules/@ai-ecoverse/wasm-curl/'),
}
const ENV = { HOME: '/home/user' }
const PROJECT = {
  'PRODUCT.md': '# Product\n\nA quiet note-taking app for field researchers.\n',
  'DESIGN.md': '---\nname: Field Notes\ndescription: Plain type on paper-white surfaces.\ncolors:\n  ink: "#142720"\n  paper: "#ffffff"\n---\n\nCalm, legible, nothing loud.\n',
  'index.html': '<!doctype html>\n<html>\n  <head><title>Field Notes</title></head>\n  <body>\n    <main><h1>Field Notes</h1></main>\n  </body>\n</html>\n',
  '.impeccable/live/config.json': JSON.stringify({ files: ['index.html'], insertBefore: '</body>', commentSyntax: 'html' }),
}

async function kernel () {
  const k = await createNodeKernel()
  for (const [name, base] of Object.entries(PACKAGES)) {
    for (const entry of await readdir(base, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue
      const file = join(entry.parentPath, entry.name)
      await k.writeFile(`/node_modules/${name}/${relative(base, file)}`, await readFile(file))
    }
  }
  for (const [path, text] of Object.entries(PROJECT)) await k.writeFile(`/home/proj/${path}`, text)
  return k
}

const output = r => `status ${r.status}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`
const run = (k, argv) => k.run(argv, { cwd: '/home/proj', env: ENV })
const within = (promise, ms, what) =>
  Promise.race([promise, sleep(ms).then(() => { throw new Error(`${what} did not finish within ${ms} ms`) })])

test('live: detached server, SSE to a page-like client, a browser event reaches live-poll', async () => {
  const k = await kernel()
  try {
    // Boot: config + context found, server started detached, script injected.
    const boot = await run(k, ['impeccable', 'live'])
    assert.equal(boot.status, 0, output(boot))
    const info = JSON.parse(boot.stdout)
    assert.equal(info.ok, true, output(boot))
    const { serverPort: port, serverToken: token } = info
    assert.ok(port >= 8400 && token, output(boot))
    const page = new TextDecoder().decode(await k.readFile('/home/proj/index.html'))
    assert.ok(page.includes(`<script src="http://localhost:${port}/live.js?token=${token}"></script>`), `script tag not injected:\n${page}`)
    const base = `http://127.0.0.1:${port}`

    // The server runs in its own process; a second `live` reuses it.
    const again = await run(k, ['impeccable', 'live'])
    assert.equal(JSON.parse(again.stdout).serverPort, port, output(again))

    // The browser script, as the page would load it.
    const script = await run(k, ['curl', '-sf', `${base}/live.js?token=${token}`])
    assert.equal(script.status, 0, output(script))
    assert.ok(script.stdout.length > 10_000, `live.js is ${script.stdout.length} bytes`)

    // A wrong token is refused.
    const denied = await run(k, ['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', `${base}/events?token=nope`])
    assert.equal(denied.stdout, '401', output(denied))

    // SSE: the page's event stream opens with a `connected` frame.
    // (The server shuts itself down a while after its last page leaves, so
    // the reader stays connected until the server is stopped below.)
    const sse = run(k, ['curl', '-sN', '--max-time', '60', `${base}/events?token=${token}`])

    // The agent's one-shot poll blocks until a browser event arrives.
    const poll = run(k, ['impeccable', 'live-poll', '--timeout=20000'])
    let polling = false
    for (let i = 0; i < 100 && !polling; i++) {
      await sleep(100)
      const status = await run(k, ['impeccable', 'live-status'])
      polling = JSON.parse(status.stdout).liveServer?.agentPolling === true
    }
    assert.ok(polling, 'live-poll never registered with the server')

    // The page posts an event; live-poll prints it and exits.
    const post = await run(k, [
      'curl', '-sf', '-X', 'POST', '-H', 'Content-Type: application/json',
      '--data', JSON.stringify({ type: 'prefetch', pageUrl: 'http://localhost:5173/', token }), `${base}/events`,
    ])
    assert.equal(post.status, 0, output(post))
    const polled = await within(poll, 15_000, 'live-poll')
    assert.equal(polled.status, 0, output(polled))
    const event = JSON.parse(polled.stdout)
    assert.equal(event.type, 'prefetch', output(polled))
    assert.equal(event.pageUrl, 'http://localhost:5173/', output(polled))

    // Stop: the server process goes away, which ends the page's stream, and
    // the port closes.
    const stop = await run(k, ['impeccable', 'live-server', 'stop'])
    assert.equal(stop.status, 0, output(stop))
    assert.match(stop.stdout, new RegExp(`Stopped live server on port ${port}`))
    const stream = await within(sse, 15_000, 'the SSE reader')
    assert.match(stream.stdout, /^data: \{"type":"connected"/m, output(stream))
    let refused
    for (let i = 0; i < 50 && refused?.status !== 7; i++) {
      await sleep(100)
      refused = await run(k, ['curl', '-s', '--max-time', '2', `${base}/health`])
    }
    assert.equal(refused.status, 7, `curl should get connection refused after stop: ${output(refused)}`)
  } finally {
    await run(k, ['impeccable', 'live-server', 'stop']).catch(() => undefined)
    k.terminate()
  }
})

