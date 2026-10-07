// End-to-end: protoc-gen-go.wasm as a slicc-kernel command, run as a local
// plugin by the published @ai-ecoverse/wasi-buf. Its output must match
// fixtures/golden, which native protoc-gen-go 1.36.12 produced from the same
// module.
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createNodeKernel } from '@ai-ecoverse/slicc-kernel/node'

const here = path => fileURLToPath(new URL(path, import.meta.url))
const PACKAGES = {
  'wasi-protoc-gen-go': here('../../package/'),
  'wasi-buf': here('../node_modules/@ai-ecoverse/wasi-buf/'),
}
const MODULE = here('../fixtures/module/')
const GOLDEN = here('../fixtures/golden/')
const APP = '/home/app'

async function files (base) {
  const out = []
  for (const entry of await readdir(base, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) out.push(relative(base, join(entry.parentPath, entry.name)))
  }
  return out.sort()
}

async function kernelWithModule () {
  const kernel = await createNodeKernel({})
  for (const [name, base] of Object.entries(PACKAGES)) {
    for (const path of await files(base)) await kernel.writeFile(`/node_modules/@ai-ecoverse/${name}/${path}`, await readFile(join(base, path)))
  }
  for (const path of await files(MODULE)) await kernel.writeFile(`${APP}/${path}`, await readFile(join(MODULE, path)))
  return kernel
}

const output = result => `${result.stdout}${result.stderr}`

test('protoc-gen-go runs as a command', async () => {
  const kernel = await kernelWithModule()
  try {
    const result = await kernel.run(['protoc-gen-go', '--version'], { cwd: APP })
    assert.equal(result.status, 0, output(result))
    assert.equal(result.stdout.trim(), 'protoc-gen-go v1.36.12')
  } finally {
    kernel.terminate()
  }
})

test('buf generate runs protoc-gen-go as a local plugin and matches native output', async () => {
  const kernel = await kernelWithModule()
  try {
    await kernel.writeFile(`${APP}/buf.gen.yaml`, 'version: v2\nplugins:\n  - local: protoc-gen-go\n    out: gen\n    opt: paths=source_relative\n')
    const result = await kernel.run(['buf', 'generate'], { cwd: APP })
    assert.equal(result.status, 0, output(result))
    const golden = await files(GOLDEN)
    assert.deepEqual(golden, ['acme/pet/v1/kind.pb.go', 'acme/pet/v1/pet.pb.go'])
    for (const path of golden) {
      const generated = new TextDecoder().decode(await kernel.readFile(`${APP}/gen/${path}`))
      assert.equal(generated, await readFile(join(GOLDEN, path), 'utf8'), path)
    }
  } finally {
    kernel.terminate()
  }
})
