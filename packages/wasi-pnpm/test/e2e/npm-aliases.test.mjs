// End-to-end: npm, npx and i (shims/, homescoop#89) on slicc-kernel's
// headless Node entry, against the local mock registry. /bin/sh is wasm-bash.
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createNodeKernel, nodeTransport } from '@ai-ecoverse/slicc-kernel/node'
import { startRegistry } from '../fixtures/registry.mjs'

const here = path => fileURLToPath(new URL(path, import.meta.url))
const PACKAGES = {
  'wasi-pnpm': here('../../package/'),
  'wasm-bash': here('../node_modules/@ai-ecoverse/wasm-bash/'),
}
const ENV = { HOME: '/home', PNPM_HOME: '/home/.local/share/pnpm', PATH: '/home/.local/share/pnpm/bin:/usr/bin:/bin' }

async function stage (kernel, name) {
  const base = PACKAGES[name]
  for (const entry of await readdir(base, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const file = join(entry.parentPath, entry.name)
    await kernel.writeFile(`/node_modules/@ai-ecoverse/${name}/${relative(base, file)}`, await readFile(file))
  }
}

async function kernel () {
  const k = await createNodeKernel({ network: { transport: nodeTransport() } })
  for (const name of Object.keys(PACKAGES)) await stage(k, name)
  return k
}

const writeJson = (k, path, value) => k.writeFile(path, JSON.stringify(value))
const text = async (k, path) => new TextDecoder().decode(await k.readFile(path))
const output = result => `${result.stdout}${result.stderr}`
const run = (k, argv, cwd = '/home') => k.run(argv, { cwd, env: ENV })

test('npm -v and npx -v print pnpm\'s version, the note only on stderr', async () => {
  const k = await kernel()
  try {
    for (const cmd of ['npm', 'npx']) {
      const r = await run(k, [cmd, '-v'])
      assert.equal(r.status, 0, output(r))
      assert.equal(r.stdout, '12.9.1\n')
      assert.match(r.stderr, new RegExp(`^${cmd} → pnpm: `))
    }
  } finally {
    k.terminate()
  }
})

test('npm install / i with no package install the project; npm ci keeps the lockfile', async () => {
  const registry = await startRegistry()
  registry.add('tiny-b', '1.2.0', { main: 'index.js' }, { 'index.js': 'module.exports = "b"\n' })
  const k = await kernel()
  try {
    for (const [dir, argv] of [['/home/a', ['npm', 'install']], ['/home/b', ['i']]]) {
      await writeJson(k, `${dir}/package.json`, { name: 'app', version: '1.0.0', dependencies: { 'tiny-b': '1.2.0' } })
      const r = await run(k, [...argv, '--registry', registry.base], dir)
      assert.equal(r.status, 0, `${argv.join(' ')}: ${output(r)}`)
      assert.equal(await text(k, `${dir}/node_modules/tiny-b/index.js`), 'module.exports = "b"\n')
      assert.equal(r.stderr.includes('npm → pnpm'), false, 'no note outside -v')
    }
    const ci = await run(k, ['npm', 'ci', '--registry', registry.base], '/home/a')
    assert.equal(ci.status, 0, output(ci))
  } finally {
    k.terminate()
    await registry.close()
  }
})

test('npm i <pkg> adds it; npm uninstall removes it', async () => {
  const registry = await startRegistry()
  registry.add('tiny-c', '2.0.0', { main: 'index.js' }, { 'index.js': 'module.exports = "c"\n' })
  const k = await kernel()
  try {
    await writeJson(k, '/home/app/package.json', { name: 'app', version: '1.0.0' })
    const add = await run(k, ['npm', 'i', '-E', 'tiny-c', '--registry', registry.base], '/home/app')
    assert.equal(add.status, 0, output(add))
    assert.equal(JSON.parse(await text(k, '/home/app/package.json')).dependencies['tiny-c'], '2.0.0')
    const rm = await run(k, ['npm', 'uninstall', 'tiny-c'], '/home/app')
    assert.equal(rm.status, 0, output(rm))
    assert.equal(JSON.parse(await text(k, '/home/app/package.json')).dependencies?.['tiny-c'], undefined)
  } finally {
    k.terminate()
    await registry.close()
  }
})

test('npm run, npm test and npm run with -- arguments run package scripts', async () => {
  const k = await kernel()
  try {
    await writeJson(k, '/home/app/package.json', {
      name: 'app',
      version: '1.0.0',
      scripts: { build: 'echo built > out.txt', test: 'echo tested', args: 'echo got' },
    })
    const build = await run(k, ['npm', 'run', 'build'], '/home/app')
    assert.equal(build.status, 0, output(build))
    assert.equal(await text(k, '/home/app/out.txt'), 'built\n')
    const t = await run(k, ['npm', 'test'], '/home/app')
    assert.equal(t.status, 0, output(t))
    assert.match(t.stdout, /tested/)
    const args = await run(k, ['npm', 'run', 'args', '--', 'one', 'two'], '/home/app')
    assert.equal(args.status, 0, output(args))
    assert.match(args.stdout, /got one two/)
    const missing = await run(k, ['npm', 'run', 'nope'], '/home/app')
    assert.notEqual(missing.status, 0, 'a missing script fails')
  } finally {
    k.terminate()
  }
})

test('npm i -g installs a command that npx runs; npx of anything else says what to install', async () => {
  const registry = await startRegistry()
  registry.add('tiny-sh', '1.0.0', { slicc: { abi: 'wasi', commands: { tinysh: { script: 'tiny.sh' } } } }, {
    'tiny.sh': '#!/bin/sh\necho "tinysh $*"\n',
  })
  const k = await kernel()
  try {
    const add = await run(k, ['npm', 'i', '-g', 'tiny-sh', '--registry', registry.base])
    assert.equal(add.status, 0, output(add))
    const direct = await run(k, ['npx', 'tinysh', '--version'])
    assert.equal(direct.status, 0, output(direct))
    assert.equal(direct.stdout, 'tinysh --version\n')
    const missing = await run(k, ['npx', 'hs89-not-installed', '--help'])
    assert.equal(missing.status, 127, output(missing))
    assert.match(missing.stderr, /'hs89-not-installed' is not installed; run 'npm i -g hs89-not-installed'/)
    const rm = await run(k, ['npm', 'uninstall', '-g', 'tiny-sh'])
    assert.equal(rm.status, 0, output(rm))
  } finally {
    k.terminate()
    await registry.close()
  }
})

test('npm refuses --no-save and a global install without a package', async () => {
  const k = await kernel()
  try {
    const noSave = await run(k, ['npm', 'i', '--no-save', 'x'])
    assert.equal(noSave.status, 1)
    assert.match(noSave.stderr, /--no-save has no pnpm equivalent/)
    const bare = await run(k, ['npm', 'install', '-g'])
    assert.equal(bare.status, 1)
    assert.match(bare.stderr, /needs a package name/)
  } finally {
    k.terminate()
  }
})

test('release age: unpinned npm i -g says which version to pin; pinned and help', async () => {
  const registry = await startRegistry()
  const day = 24 * 3600 * 1000
  registry.add('tiny-age', '1.0.0', { main: 'i.js' }, { 'i.js': '1' }, { published: new Date(Date.now() - 30 * day) })
  registry.add('tiny-age', '1.1.0', { main: 'i.js' }, { 'i.js': '2' }, { published: new Date(Date.now() - 60 * 1000) })
  registry.add('tiny-old', '2.0.0', { main: 'i.js' }, { 'i.js': '1' }, { published: new Date(Date.now() - 30 * day) })
  const k = await kernel()
  const installed = async () => output(await run(k, ['pnpm', 'list', '-g', '--depth=0']))
  try {
    // pnpm keeps minimumReleaseAge: the 1-minute-old 1.1.0 is skipped.
    const fresh = await run(k, ['npm', 'i', '-g', 'tiny-age', '--registry', registry.base])
    assert.equal(fresh.status, 0, output(fresh))
    assert.match(await installed(), /tiny-age@1\.0\.0/)
    assert.match(fresh.stderr, /installed tiny-age 1\.0\.0, not latest 1\.1\.0 .*pin tiny-age@1\.1\.0/)
    // Pinned: installs it, no hint.
    const pinned = await run(k, ['npm', 'i', '-g', 'tiny-age@1.1.0', '--registry', registry.base])
    assert.equal(pinned.status, 0, output(pinned))
    assert.match(await installed(), /tiny-age@1\.1\.0/)
    assert.doesNotMatch(pinned.stderr, /not latest/)
    // Latest is mature: no hint.
    const old = await run(k, ['npm', 'i', '-g', 'tiny-old', '--registry', registry.base])
    assert.equal(old.status, 0, output(old))
    assert.doesNotMatch(old.stderr, /not latest/)
    // Help texts and npx name the pinning tip.
    for (const argv of [['npm', 'help'], ['npm', 'i', '--help']]) {
      const help = await run(k, argv)
      assert.equal(help.status, 0, `${argv.join(' ')}: ${output(help)}`)
      assert.match(help.stdout, /less than 24 h old.*pin pkg@x\.y\.z-n/)
    }
    const npx = await run(k, ['npx', 'hs90-not-installed'])
    assert.equal(npx.status, 127)
    assert.match(npx.stderr, /less than 24 h old; pin hs90-not-installed@x\.y\.z-n/)
  } finally {
    k.terminate()
    await registry.close()
  }
})

