// Stages wasix-selftest.wasm as a WASI command in a headless slicc kernel
// (the published @ai-ecoverse/slicc-kernel's Node entry, no browser).
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createNodeKernel } from '@ai-ecoverse/slicc-kernel/node'

const wasmPath = process.env.WASIX_SELFTEST_WASM ??
  fileURLToPath(new URL('../../target/wasm32-wasip1/release/wasix-selftest.wasm', import.meta.url))

const manifest = {
  name: 'wasix-selftest',
  version: '0.0.0',
  slicc: { abi: 'wasi', commands: { 'wasix-selftest': { wasm: 'bin/wasix-selftest.wasm' } } },
}

export async function kernelWithSelftest (options = {}) {
  const kernel = await createNodeKernel(options)
  await kernel.writeFile('/node_modules/wasix-selftest/package.json', JSON.stringify(manifest))
  await kernel.writeFile('/node_modules/wasix-selftest/bin/wasix-selftest.wasm', await readFile(wasmPath))
  await kernel.writeFile('/tmp/.keep', '')
  return kernel
}

export const output = result => `status ${result.status}\n--- stdout\n${result.stdout}\n--- stderr\n${result.stderr}`
