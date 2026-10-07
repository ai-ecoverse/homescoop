// End-to-end: protoc-gen-connect-go.wasm as a slicc-kernel command, run as a local
// plugin by the published @ai-ecoverse/wasi-buf. Its output must match
// fixtures/golden, which native protoc-gen-connect-go 1.21.0 produced from the same
// module.
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createNodeKernel } from '@ai-ecoverse/slicc-kernel/node'

const here = path => fileURLToPath(new URL(path, import.meta.url))
const PACKAGES = {
  'wasi-protoc-gen-connect-go': here('../../package/'),
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

test('protoc-gen-connect-go runs as a command', async () => {
  const kernel = await kernelWithModule()
  try {
    const result = await kernel.run(['protoc-gen-connect-go', '--version'], { cwd: APP })
    assert.equal(result.status, 0, output(result))
    assert.equal(result.stdout.trim(), '1.21.0')
  } finally {
    kernel.terminate()
  }
})

test('buf generate runs protoc-gen-connect-go as a local plugin and matches native output', async () => {
  const kernel = await kernelWithModule()
  try {
    await kernel.writeFile(`${APP}/buf.gen.yaml`, 'version: v2\nplugins:\n  - local: protoc-gen-connect-go\n    out: gen\n    opt: paths=source_relative\n')
    const result = await kernel.run(['buf', 'generate'], { cwd: APP })
    assert.equal(result.status, 0, output(result))
    const golden = await files(GOLDEN)
    assert.deepEqual(golden, ['acme/pet/v1/petv1connect/pet.connect.go'])
    for (const path of golden) {
      const generated = new TextDecoder().decode(await kernel.readFile(`${APP}/gen/${path}`))
      assert.equal(generated, await readFile(join(GOLDEN, path), 'utf8'), path)
    }
  } finally {
    kernel.terminate()
  }
})
