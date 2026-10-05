// End-to-end: upstream pnpm.wasm + host/pnpm-host.mjs on the published
// slicc-kernel's headless Node entry. Network goes only to a local mock
// registry and a local git server; nothing reaches the real registry.
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createNodeKernel, nodeTransport } from '@ai-ecoverse/slicc-kernel/node'
import { CA_MISSING, GIT_MISSING, GIT_UNSUPPORTED, PUBLISH_UNSUPPORTED, TLS_MISSING } from '../../package/host/pnpm-host.mjs'
import { startGitServer } from '../fixtures/git-server.mjs'
import { startRegistry } from '../fixtures/registry.mjs'

const here = path => fileURLToPath(new URL(path, import.meta.url))
const PACKAGES = {
  'wasi-pnpm': here('../../package/'),
  'wasm-git': here('../node_modules/@ai-ecoverse/wasm-git/'),
  'wasm-tls-engine': here('../node_modules/@ai-ecoverse/wasm-tls-engine/'),
}
const TOKEN = 'npm_FAKE_E2E_TOKEN_9b1f0c'
const corsTransport = () => {
  const base = nodeTransport()
  return { traits: { ...base.traits, crossOrigin: 'cors' }, fetch: request => base.fetch(request) }
}

async function stage (kernel, name) {
  const base = PACKAGES[name]
  for (const entry of await readdir(base, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const file = join(entry.parentPath, entry.name)
    await kernel.writeFile(`/node_modules/@ai-ecoverse/${name}/${relative(base, file)}`, await readFile(file))
  }
}

async function kernelWith (names, network = { transport: nodeTransport() }) {
  const kernel = await createNodeKernel({ network })
  for (const name of names) await stage(kernel, name)
  return kernel
}

const writeJson = (kernel, path, value) => kernel.writeFile(path, JSON.stringify(value))
const output = result => `${result.stdout}${result.stderr}`
const flat = text => text.replace(/[\s│╰─▶×]+/g, '')
const mentions = (result, message) => flat(output(result)).includes(flat(message))
const lanAddress = () => Object.values(networkInterfaces()).flat().find(i => i?.family === 'IPv4' && !i.internal)?.address

test('pnpm runs and installs a file: dependency offline', async () => {
  const kernel = await kernelWith(['wasi-pnpm'], undefined)
  try {
    assert.equal((await kernel.run(['pnpm', '--version'], { cwd: '/home' })).stdout, '12.9.1\n')
    await writeJson(kernel, '/home/lib-a/package.json', { name: 'lib-a', version: '1.0.0', main: 'index.js' })
    await kernel.writeFile('/home/lib-a/index.js', 'module.exports = 42\n')
    await writeJson(kernel, '/home/app/package.json', { name: 'app', version: '1.0.0', dependencies: { 'lib-a': 'file:../lib-a' } })
    const result = await kernel.run(['pnpm', 'install', '--offline'], { cwd: '/home/app' })
    assert.equal(result.status, 0, output(result))
    assert.equal(new TextDecoder().decode(await kernel.readFile('/home/app/node_modules/lib-a/index.js')), 'module.exports = 42\n')
  } finally {
    kernel.terminate()
  }
})

test('pnpm installs from a registry into a hoisted node_modules', async () => {
  const registry = await startRegistry({ token: TOKEN })
  registry.add('tiny-b', '1.2.0', { main: 'index.js' }, { 'index.js': 'module.exports = "b"\n' })
  registry.add('tiny-a', '1.0.0', { main: 'index.js', dependencies: { 'tiny-b': '^1.0.0' } }, { 'index.js': 'module.exports = "a"\n' })
  const kernel = await kernelWith(['wasi-pnpm'])
  try {
    await writeJson(kernel, '/home/app/package.json', { name: 'app', version: '1.0.0', dependencies: { 'tiny-a': '1.0.0' } })
    const result = await kernel.run(['pnpm', 'install', '--registry', registry.base], { cwd: '/home/app' })
    assert.equal(result.status, 0, output(result))
    assert.equal(new TextDecoder().decode(await kernel.readFile('/home/app/node_modules/tiny-b/index.js')), 'module.exports = "b"\n')
    assert.match(new TextDecoder().decode(await kernel.readFile('/home/app/pnpm-lock.yaml')), /tiny-b@1\.2\.0/)
  } finally {
    kernel.terminate()
    await registry.close()
  }
})

test('pnpm publishes with auth and --otp, streams a large body and never prints the token', async () => {
  const registry = await startRegistry({ token: TOKEN })
  const kernel = await kernelWith(['wasi-pnpm'])
  try {
    await writeJson(kernel, '/home/pub/package.json', { name: 'wasi-pnpm-e2e-probe', version: '1.0.0' })
    await kernel.writeFile('/home/pub/big.bin', Uint8Array.from({ length: 3 * 1024 * 1024 }, () => (Math.random() * 256) | 0))
    await kernel.writeFile('/home/pub/.npmrc', `${registry.base.replace(/^http:/, '')}:_authToken=${TOKEN}\n`)
    const publish = args => kernel.run(['pnpm', 'publish', '--no-git-checks', '--registry', registry.base, ...args], { cwd: '/home/pub' })
    const challenged = await publish([])
    assert.equal(challenged.status, 1)
    assert.match(output(challenged), /--otp/)
    const done = await publish(['--otp', '123456'])
    assert.equal(done.status, 0, output(done))
    assert.ok(registry.published.at(-1).bytes > 3 * 1024 * 1024)
    assert.deepEqual(registry.published.map(p => [p.authorized, p.otp]), [[true, null], [true, '123456']])
    await registry.close()
    const down = await publish(['--otp', '123456'])
    assert.equal(down.status, 1)
    assert.match(output(down), /could not reach/)
    for (const result of [challenged, done, down]) assert.ok(!output(result).includes(TOKEN))
    const leaks = []
    const scan = async (dir, path) => {
      for await (const [name, handle] of dir.entries()) {
        const full = `${path}/${name}`
        if (handle.kind === 'directory') await scan(handle, full)
        else if (full !== '/home/pub/.npmrc' && new TextDecoder().decode(await (await handle.getFile()).arrayBuffer()).includes(TOKEN)) leaks.push(full)
      }
    }
    await scan(kernel.root, '')
    assert.deepEqual(leaks, [])
  } finally {
    kernel.terminate()
  }
})

test('pnpm installs a git dependency through wasm-git', { skip: lanAddress() || process.env.CI ? false : 'no non-loopback address for the realm proxy to reach' }, async () => {
  assert.ok(lanAddress(), 'CI needs a non-loopback IPv4 for the git-clone test (the realm proxy refuses loopback)')
  const git = await startGitServer({ host: lanAddress() })
  const repo = git.repo('lib-git', { 'package.json': JSON.stringify({ name: 'lib-git', version: '1.0.0', main: 'index.js' }), 'index.js': 'module.exports = "git"\n' }, { tag: 'v1.0.0' })
  const kernel = await kernelWith(['wasi-pnpm', 'wasm-git', 'wasm-tls-engine'])
  try {
    await writeJson(kernel, '/home/app/package.json', { name: 'app', version: '1.0.0', dependencies: { 'lib-git': `git+${repo.url}#v1.0.0` } })
    const result = await kernel.run(['pnpm', 'install'], { cwd: '/home/app' })
    assert.equal(result.status, 0, output(result))
    assert.equal(new TextDecoder().decode(await kernel.readFile('/home/app/node_modules/lib-git/index.js')), 'module.exports = "git"\n')
  } finally {
    kernel.terminate()
    await git.close()
  }
})

test('pnpm names the missing piece for git dependencies', async () => {
  const project = { name: 'app', version: '1.0.0', dependencies: { odd: 'github:jonschlinkert/is-odd#3.0.1' } }
  const cases = [
    [['wasi-pnpm'], GIT_MISSING],
    [['wasi-pnpm', 'wasm-git'], TLS_MISSING],
    [['wasi-pnpm', 'wasm-git', 'wasm-tls-engine'], CA_MISSING],
  ]
  for (const [names, message] of cases) {
    const kernel = await kernelWith(names)
    try {
      if (message === CA_MISSING) await kernel.root.getDirectoryHandle('etc').then(etc => etc.getDirectoryHandle('ssl')).then(ssl => ssl.removeEntry('certs', { recursive: true }))
      await writeJson(kernel, '/home/app/package.json', project)
      const result = await kernel.run(['pnpm', 'install'], { cwd: '/home/app' })
      assert.equal(result.status, 1)
      assert.ok(mentions(result, message), output(result))
    } finally {
      kernel.terminate()
    }
  }
})

test('pnpm refuses publish and git on a CORS-only transport', async () => {
  const kernel = await kernelWith(['wasi-pnpm', 'wasm-git', 'wasm-tls-engine'], { transport: corsTransport() })
  try {
    await writeJson(kernel, '/home/pub/package.json', { name: 'wasi-pnpm-e2e-probe', version: '1.0.0' })
    const publish = await kernel.run(['pnpm', 'publish', '--no-git-checks', '--registry', 'https://registry.invalid/'], { cwd: '/home/pub' })
    assert.ok(mentions(publish, PUBLISH_UNSUPPORTED), output(publish))
    await writeJson(kernel, '/home/app/package.json', { name: 'app', version: '1.0.0', dependencies: { lib: 'git+https://git.invalid/lib.git#v1' } })
    const git = await kernel.run(['pnpm', 'install'], { cwd: '/home/app' })
    assert.ok(mentions(git, GIT_UNSUPPORTED), output(git))
  } finally {
    kernel.terminate()
  }
})
