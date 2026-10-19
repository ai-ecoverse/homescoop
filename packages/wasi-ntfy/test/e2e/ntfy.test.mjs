import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readdir, readFile } from 'node:fs/promises'
import { relative, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createNodeKernel, nodeTransport } from '@ai-ecoverse/slicc-kernel/node'

const here = path => fileURLToPath(new URL(path, import.meta.url))
const PACKAGES = {
  'wasi-ntfy': here('../../package/'),
  'wasm-bash': here('../node_modules/@ai-ecoverse/wasm-bash/'),
}
const env = { HOME: '/home/app' }
const output = result => `${result.stdout}${result.stderr}`
const line = event => `${JSON.stringify(event)}\n`
const within = (ms, promise) => Promise.race([promise, new Promise((resolve, reject) => setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms).unref())])

async function install (kernel, name, { hostModule = true } = {}) {
  const base = PACKAGES[name]
  for (const entry of await readdir(base, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const file = join(entry.parentPath, entry.name)
    let data = await readFile(file)
    if (name === 'wasi-ntfy' && !hostModule && relative(base, file) === 'package.json') {
      const manifest = JSON.parse(data)
      delete manifest.slicc.commands.ntfy.imports
      data = Buffer.from(JSON.stringify(manifest))
    }
    await kernel.writeFile(`/node_modules/@ai-ecoverse/${name}/${relative(base, file)}`, data)
  }
}

async function kernelWith (options = {}) {
  const kernel = await createNodeKernel({ network: { transport: nodeTransport({ hostLoopback: true }) } })
  await install(kernel, 'wasi-ntfy', options)
  await install(kernel, 'wasm-bash')
  return kernel
}

async function serve (handler) {
  const requests = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const record = { at: Date.now(), method: req.method, url: req.url, auth: req.headers.authorization ?? '', body: Buffer.concat(chunks).toString('utf8') }
      requests.push(record)
      handler(record, res, requests)
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    requests,
    base: `http://host.slicc.internal:${server.address().port}`,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }),
  }
}

const published = (res, topic, message) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(line({ id: `p${Date.now()}`, time: 1, event: 'message', topic, message }))
}

const unauthorized = res => {
  res.writeHead(401, { 'content-type': 'application/json' })
  res.end('{"code":40101,"http":401,"error":"unauthorized"}\n')
}

test('ntfy sub runs each message\'s command as its line arrives, before the next one is sent', async () => {
  const kernel = await kernelWith()
  let stream
  let streams = 0
  const server = await serve((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/live/json')) {
      if (streams++ > 0) return unauthorized(res)
      stream = res
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.write(line({ id: 'open1', time: 100, event: 'open', topic: 'live' }))
      res.write(line({ id: 'm1', time: 101, event: 'message', topic: 'live', message: 'first', title: 'one' }))
      return
    }
    if (req.method === 'POST' && req.url === '/ack') {
      published(res, 'ack', req.body)
      if (req.body === 'm1') stream.write(line({ id: 'm2', time: 102, event: 'message', topic: 'live', message: 'second', title: 'two' }))
      if (req.body === 'm2') stream.end()
      return
    }
    res.writeHead(404)
    res.end()
  })
  try {
    const result = await within(60000, kernel.run(
      ['ntfy', 'sub', `${server.base}/live`, `printf '%s|%s|%s\\n' "$NTFY_ID" "$NTFY_TITLE" "$NTFY_MESSAGE"; id=$NTFY_ID; unset \${!NTFY_*}; ntfy pub --quiet ${server.base}/ack "$id"`],
      { cwd: '/home/app', env },
    ))
    assert.equal(result.status, 1, output(result))
    assert.equal(result.stdout, 'm1|one|first\nm2|two|second\n')
    assert.match(result.stderr, /401 Unauthorized/)
    const gets = server.requests.filter(r => r.method === 'GET')
    assert.deepEqual(gets.map(r => r.url), ['/live/json', '/live/json?since=m2'])
    assert.deepEqual(server.requests.filter(r => r.method === 'POST').map(r => r.body), ['m1', 'm2'])
  } finally {
    await server.close()
    kernel.terminate()
  }
})

test('a 60 KiB message line split across chunks reaches the command whole', async () => {
  const kernel = await kernelWith()
  const big = 'x'.repeat(60 * 1024)
  const server = await serve((req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    const text = line({ id: 'big1', time: 1, event: 'message', topic: 'big', message: big })
    let at = 0
    const next = () => {
      if (at >= text.length) return res.end()
      res.write(text.slice(at, at + 7000))
      at += 7000
      setTimeout(next, 5)
    }
    next()
  })
  try {
    const result = await kernel.run(
      ['ntfy', 'sub', '--poll', '--since', 'all', `${server.base}/big`, 'printf "%s %s\\n" "$NTFY_ID" "${#NTFY_MESSAGE}"'],
      { cwd: '/home/app', env },
    )
    assert.equal(result.status, 0, output(result))
    assert.equal(result.stdout, `big1 ${big.length}\n`)
    assert.equal(server.requests[0].url, '/big/json?poll=1&since=all')
  } finally {
    await server.close()
    kernel.terminate()
  }
})

test('ntfy pub sends the token as a Bearer header and prints the server\'s message', async () => {
  const kernel = await kernelWith()
  const server = await serve((req, res) => published(res, 'alerts', req.body))
  try {
    const result = await kernel.run(['ntfy', 'pub', '--token', 'tk_testtoken', `${server.base}/alerts`, 'disk', 'full'], { cwd: '/home/app', env })
    assert.equal(result.status, 0, output(result))
    assert.equal(JSON.parse(result.stdout).message, 'disk full')
    assert.equal(server.requests[0].auth, 'Bearer tk_testtoken')
    assert.equal(server.requests[0].url, '/alerts')
  } finally {
    await server.close()
    kernel.terminate()
  }
})

test('without the host module, ntfy pub says the runtime cannot open a connection', async () => {
  const kernel = await kernelWith({ hostModule: false })
  const server = await serve((req, res) => published(res, 't', req.body))
  try {
    const result = await kernel.run(['ntfy', 'pub', `${server.base}/t`, 'hi'], { cwd: '/home/app', env })
    assert.notEqual(result.status, 0)
    assert.match(output(result), /needs slicc-kernel with @ai-ecoverse\/wasi-ntfy's host module/)
    assert.equal(server.requests.length, 0)
  } finally {
    await server.close()
    kernel.terminate()
  }
})
