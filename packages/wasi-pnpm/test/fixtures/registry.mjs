// A local npm registry for wasi-pnpm's end-to-end tests: packuments and
// gzipped tarballs built on the fly, and PUT /<name> for publish with a
// bearer-token check and an npm OTP challenge.
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'

function header (name, size) {
  const block = Buffer.alloc(512)
  block.write(name, 0, 100, 'utf8')
  block.write('0000644\0', 100)
  block.write('0000000\0', 108)
  block.write('0000000\0', 116)
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124)
  block.write('00000000000\0', 136)
  block.write('        ', 148)
  block.write('0', 156)
  block.write('ustar\0', 257)
  block.write('00', 263)
  let sum = 0
  for (const byte of block) sum += byte
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
  return block
}

export function tarball (files) {
  const parts = []
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content)
    parts.push(header(`package/${name}`, data.length), data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  parts.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(parts))
}

export async function startRegistry ({ token } = {}) {
  const packages = new Map()
  const published = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost')
      const name = decodeURIComponent(url.pathname.slice(1))
      if (req.method === 'PUT') {
        const authorized = req.headers.authorization === `Bearer ${token}`
        published.push({ name, authorized, otp: req.headers['npm-otp'] ?? null, bytes: Buffer.concat(chunks).length })
        if (!authorized) return json(res, 401, { error: 'unauthorized' })
        if (!req.headers['npm-otp']) return json(res, 401, { error: 'OTP required' }, { 'www-authenticate': 'OTP' })
        return json(res, 200, { ok: true })
      }
      const file = /^(.+)\/-\/[^/]+-(\d[^/]*)\.tgz$/.exec(name)
      if (file) {
        const entry = packages.get(file[1])?.versions[file[2]]
        if (!entry) return json(res, 404, { error: 'not found' })
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        return res.end(entry.tarball)
      }
      const pkg = packages.get(name)
      if (!pkg) return json(res, 404, { error: 'not found' })
      return json(res, 200, pkg.packument(base))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/`
  return {
    base,
    published,
    add (name, version, manifest = {}, files = {}) {
      const json = { name, version, ...manifest }
      const tgz = tarball({ 'package.json': JSON.stringify(json), ...files })
      const pkg = packages.get(name) ?? { versions: {} }
      pkg.versions[version] = { manifest: json, tarball: tgz }
      pkg.packument = registry => ({
        name,
        'dist-tags': { latest: Object.keys(pkg.versions).at(-1) },
        versions: Object.fromEntries(Object.entries(pkg.versions).map(([v, e]) => [v, {
          ...e.manifest,
          dist: {
            tarball: `${registry}${name}/-/${name.split('/').pop()}-${v}.tgz`,
            integrity: `sha512-${createHash('sha512').update(e.tarball).digest('base64')}`,
          },
        }])),
      })
      packages.set(name, pkg)
    },
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

function json (res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}
