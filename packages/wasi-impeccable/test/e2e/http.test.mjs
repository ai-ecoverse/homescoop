// End-to-end: impeccable.wasm's HTTP verbs on the published slicc-kernel's
// headless Node entry. The guest sends every request in absolute form to the
// kernel's proxy (wasix-ureq, no TLS in the guest). This transport answers
// for impeccable.style, GitHub and OpenAI. The skill bundle is the real signed
// release, fetched from GitHub once and checked against its signature
// envelope, so the engine's compiled Ed25519 keys verify it inside WASI.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { createNodeKernel, fetchTransport } from '@ai-ecoverse/slicc-kernel/node'

const here = path => fileURLToPath(new URL(path, import.meta.url))
const PACKAGE = process.env.WASI_IMPECCABLE_PACKAGE ?? here('../../package/')
const SKILL_VERSION = '4.5.0'
const RELEASE = `https://github.com/pbakaus/impeccable/releases/download/skill-v${SKILL_VERSION}/universal.zip`
const CACHE = join(tmpdir(), `wasi-impeccable-e2e-skill-v${SKILL_VERSION}`)

let bundle
let signature
let roll

async function cached (name, url) {
  const path = join(CACHE, name)
  if (!existsSync(path)) {
    const res = await fetch(url)
    assert.equal(res.status, 200, `fetch ${url}`)
    await mkdir(CACHE, { recursive: true })
    await writeFile(path, Buffer.from(await res.arrayBuffer()))
  }
  return readFile(path)
}

before(async () => {
  signature = await cached('universal.zip.sig.json', `${RELEASE}.sig.json`)
  bundle = await cached('universal.zip', RELEASE)
  const envelope = JSON.parse(signature)
  assert.equal(bundle.length, envelope.size, 'cached bundle size')
  assert.equal(createHash('sha256').update(bundle).digest('hex'), envelope.sha256, 'cached bundle digest')
  roll = await readFile(here('../fixtures/roll-surface.json'))
})

// A valid 1x1 PNG for the fake image API.
function png () {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = bytes => {
    let x = 0xffffffff
    for (const b of bytes) x = table[(x ^ b) & 0xff] ^ (x >>> 8)
    return (x ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 255, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** The network as the guest sees it through the kernel's proxy. */
function network ({ zip = bundle } = {}) {
  const requests = []
  const reply = (status, headers, body) => new Response(body ?? null, { status, headers })
  const json = body => reply(200, { 'content-type': 'application/json' }, body)
  const transport = fetchTransport({
    fetch: async (url, init = {}) => {
      const u = new URL(String(url))
      const headers = new Headers(init.headers)
      const body = init.body ? Buffer.from(await new Response(init.body).arrayBuffer()) : undefined
      requests.push({ method: init.method ?? 'GET', url: u.href, headers, body })
      if (u.href === 'https://impeccable.style/api/download/bundle/universal') return reply(302, { location: RELEASE })
      if (u.href === 'https://impeccable.style/api/version') return json(JSON.stringify({ skills: SKILL_VERSION }))
      if (u.host === 'impeccable.style' && u.pathname === '/api/roll') return json(roll)
      if (u.href === RELEASE) return reply(200, {}, zip)
      if (u.href === `${RELEASE}.sig.json`) return reply(200, {}, signature)
      if (u.href === 'https://api.openai.com/v1/images/generations') {
        const prompt = JSON.parse(body).prompt
        return json(JSON.stringify({ data: [{ b64_json: png().toString('base64') }], prompt }))
      }
      return reply(404, {}, 'not mocked')
    },
  })
  return { transport, requests }
}

async function kernelWith (net) {
  const kernel = await createNodeKernel(net ? { network: { transport: net.transport } } : {})
  for (const entry of await readdir(PACKAGE, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const file = join(entry.parentPath, entry.name)
    await kernel.writeFile(`/node_modules/@ai-ecoverse/wasi-impeccable/${relative(PACKAGE, file)}`, await readFile(file))
  }
  return kernel
}

const ENV = { HOME: '/home/user' }
const output = r => `status ${r.status}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`
const text = async (kernel, path) => new TextDecoder().decode(await kernel.readFile(path))
const exists = (kernel, path) => kernel.readFile(path).then(() => true, () => false)

test('install fetches, verifies and extracts the signed skill bundle into the project it runs in', async () => {
  const net = network()
  const kernel = await kernelWith(net)
  try {
    await kernel.writeFile('/home/proj/README.md', '# a project\n')
    const result = await kernel.run(['impeccable', 'install', '--providers=claude', '--project', '-y'], { cwd: '/home/proj', env: ENV })
    assert.equal(result.status, 0, output(result))
    assert.match(result.stdout, /Installed impeccable into: \.claude \(project\)/)
    assert.match(await text(kernel, '/home/proj/.claude/skills/impeccable/SKILL.md'), /impeccable/i)
    assert.equal(await exists(kernel, '/.claude/skills/impeccable/SKILL.md'), false, 'installed at /, not the cwd')
    assert.deepEqual(net.requests.map(r => r.url), [
      'https://impeccable.style/api/download/bundle/universal',
      `${RELEASE}.sig.json`,
      RELEASE,
    ])

    const check = await kernel.run(['impeccable', 'check'], { cwd: '/home/proj', env: ENV })
    assert.equal(check.status, 0, output(check))
    assert.match(check.stdout, new RegExp(`up to date \\(v${SKILL_VERSION.replaceAll('.', '\\.')}\\)`))
  } finally {
    kernel.terminate()
  }
})

test('a bundle that does not match its signature is refused and nothing is installed', async () => {
  const tampered = Buffer.from(bundle)
  tampered[tampered.length >> 1] ^= 0xff
  const kernel = await kernelWith(network({ zip: tampered }))
  try {
    const result = await kernel.run(['impeccable', 'install', '--providers=claude', '--project', '-y'], { cwd: '/home/proj', env: ENV })
    assert.notEqual(result.status, 0, output(result))
    assert.match(result.stdout + result.stderr, /Could not verify skill bundle: Bundle digest or size does not match its signature/)
    assert.equal(await exists(kernel, '/home/proj/.claude/skills/impeccable/SKILL.md'), false)
  } finally {
    kernel.terminate()
  }
})

test('a forged signature fails the Ed25519 check', async () => {
  const envelope = JSON.parse(signature)
  const last = envelope.signature.at(-1)
  envelope.signature = envelope.signature.slice(0, -1) + (last === '0' ? '1' : '0')
  const net = network()
  const forged = Buffer.from(JSON.stringify(envelope))
  const original = signature
  signature = forged
  const kernel = await kernelWith(net)
  try {
    const result = await kernel.run(['impeccable', 'install', '--providers=claude', '--project', '-y'], { cwd: '/home/proj', env: ENV })
    assert.notEqual(result.status, 0, output(result))
    assert.match(result.stdout + result.stderr, /Could not verify skill bundle: Bundle signature verification failed/)
    assert.equal(await exists(kernel, '/home/proj/.claude/skills/impeccable/SKILL.md'), false)
  } finally {
    signature = original
    kernel.terminate()
  }
})

test('generate-image reads and writes relative to the directory it runs in', async () => {
  const net = network()
  const kernel = await kernelWith(net)
  try {
    await kernel.writeFile('/home/proj/site/prompts/hero.txt', 'a calm blue hero')
    await kernel.writeFile('/home/proj/site/comps/.keep', '')
    const result = await kernel.run(
      ['impeccable', 'generate-image', '--prompt-file', 'prompts/hero.txt', '--out', 'comps/hero.png', '--size', '1024x1024'],
      { cwd: '/home/proj/site', env: { ...ENV, OPENAI_API_KEY: 'sk-e2e-not-a-key' } },
    )
    assert.equal(result.status, 0, output(result))
    assert.match(result.stdout, /IMAGE: comps\/hero\.png \(1024x1024/)
    const image = await kernel.readFile('/home/proj/site/comps/hero.png')
    assert.deepEqual([...image.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
    const request = net.requests.find(r => r.url === 'https://api.openai.com/v1/images/generations')
    assert.ok(request, 'the image API was called')
    assert.equal(request.method, 'POST')
    assert.equal(request.headers.get('authorization'), 'Bearer sk-e2e-not-a-key')
    assert.equal(JSON.parse(request.body).prompt, 'a calm blue hero')
  } finally {
    kernel.terminate()
  }
})

test('concept-seed rolls through the impeccable.style API', async () => {
  const net = network()
  const kernel = await kernelWith(net)
  try {
    await kernel.writeFile('/home/proj/PRODUCT.md', '# Product\n\nA quiet note-taking app for field researchers.\n\n## Users\n\nEcologists logging observations offline.\n')
    const result = await kernel.run(['impeccable', 'concept-seed', '--scope', 'surface', '--key', 'e2e'], { cwd: '/home/proj', env: ENV })
    assert.equal(result.status, 0, output(result))
    assert.match(result.stdout, /SURFACE CONCEPT SEED .*source: api/)
    const call = net.requests.find(r => r.url.startsWith('https://impeccable.style/api/roll?'))
    assert.ok(call, `no roll request: ${net.requests.map(r => r.url)}`)
    assert.equal(new URL(call.url).searchParams.get('scope'), 'surface')
  } finally {
    kernel.terminate()
  }
})

test('https without a proxy fails clearly instead of attempting TLS', async () => {
  const kernel = await kernelWith(network())
  try {
    const noProxy = { ...ENV, https_proxy: '', HTTPS_PROXY: '', all_proxy: '', ALL_PROXY: '' }
    const result = await kernel.run(['impeccable', 'install', '--providers=claude', '--project', '-y'], { cwd: '/home/proj', env: noProxy })
    assert.notEqual(result.status, 0, output(result))
    assert.match(result.stdout + result.stderr, /no TLS/)
  } finally {
    kernel.terminate()
  }
})
