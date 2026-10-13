// End-to-end: gh.wasm and host/gh-host.mjs on slicc-kernel's headless Node
// entry. HTTP stays on a local server. git, when the test installs it, is
// @ai-ecoverse/wasm-git inside the kernel.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readdir, readFile } from 'node:fs/promises'
import { relative, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createNodeKernel, nodeTransport } from '@ai-ecoverse/slicc-kernel/node'

const here = path => fileURLToPath(new URL(path, import.meta.url))
const PACKAGES = {
  'wasi-gh': here('../../package/'),
  'wasm-git': here('../node_modules/@ai-ecoverse/wasm-git/'),
  'wasm-bash': here('../node_modules/@ai-ecoverse/wasm-bash/'),
}

async function install (kernel, name) {
  const base = PACKAGES[name]
  for (const entry of await readdir(base, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const file = join(entry.parentPath, entry.name)
    let data = await readFile(file)
    if (name === 'wasi-gh' && kernel.hostModule === false && relative(base, file) === 'package.json') {
      const manifest = JSON.parse(data)
      delete manifest.slicc.commands.gh.imports
      data = Buffer.from(JSON.stringify(manifest))
    }
    await kernel.writeFile(`/node_modules/@ai-ecoverse/${name}/${relative(base, file)}`, data)
  }
}

async function kernelWith ({ hostModule = true, git = false } = {}) {
  const kernel = await createNodeKernel({ network: { transport: nodeTransport() } })
  kernel.hostModule = hostModule
  await install(kernel, 'wasi-gh')
  if (git) {
    await install(kernel, 'wasm-bash')
    await install(kernel, 'wasm-git')
  }
  return kernel
}

const output = result => `${result.stdout}${result.stderr}`

async function serve () {
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ method: req.method, url: req.url, auth: req.headers.authorization ?? '', body }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) }
}

const env = {
  HOME: '/home/app',
  GH_CONFIG_DIR: '/home/app/.config/gh',
  GH_TOKEN: 'test-token',
  GH_NO_UPDATE_NOTIFIER: '1',
}

test('gh version prints the pinned release', async () => {
  const kernel = await kernelWith()
  try {
    const result = await kernel.run(['gh', 'version'], { cwd: '/home/app', env })
    assert.equal(result.status, 0, output(result))
    assert.match(result.stdout, /^gh version 2\.102\.0 \(2026-09-29\)\nhttps:\/\/github\.com\/cli\/cli\/releases\/tag\/v2\.102\.0\n/)
  } finally {
    kernel.terminate()
  }
})

test('gh api sends an absolute URL through the host module', async () => {
  const kernel = await kernelWith()
  const server = await serve()
  try {
    const result = await kernel.run(['gh', 'api', `${server.base}/user`, '-X', 'POST', '-f', 'title=hi'], { cwd: '/home/app', env })
    assert.equal(result.status, 0, output(result))
    const body = JSON.parse(result.stdout)
    assert.equal(body.method, 'POST')
    assert.equal(body.url, '/user')
    assert.match(body.body, /hi/)
  } finally {
    await server.close()
    kernel.terminate()
  }
})

test('without the host module, gh api says the runtime cannot open a connection', async () => {
  const kernel = await kernelWith({ hostModule: false })
  const server = await serve()
  try {
    const result = await kernel.run(['gh', 'api', `${server.base}/user`], { cwd: '/home/app', env })
    assert.notEqual(result.status, 0)
    assert.match(output(result), /needs slicc-kernel with @ai-ecoverse\/wasi-gh's host module/)
  } finally {
    await server.close()
    kernel.terminate()
  }
})

test('gh runs wasm-git inside a repository', async () => {
  const kernel = await kernelWith({ git: true })
  try {
    const gitEnv = { ...env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid' }
    let result = await kernel.run(['git', 'init', '-q', '-b', 'main'], { cwd: '/home/app', env: gitEnv })
    assert.equal(result.status, 0, output(result))
    result = await kernel.run(['git', 'remote', 'add', 'origin', 'https://github.com/cli/cli.git'], { cwd: '/home/app', env: gitEnv })
    assert.equal(result.status, 0, output(result))
    result = await kernel.run(['gh', 'repo', 'set-default', '--view'], { cwd: '/home/app', env })
    assert.equal(result.status, 0, output(result))
    assert.match(result.stderr, /No default remote repository has been set/)
  } finally {
    kernel.terminate()
  }
})
