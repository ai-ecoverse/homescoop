// End-to-end: buf.wasm on the published slicc-kernel's headless Node entry,
// against a small proto module. Offline only.
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createNodeKernel } from '@ai-ecoverse/slicc-kernel/node'

const PACKAGE = fileURLToPath(new URL('../../package/', import.meta.url))
const APP = '/home/app'
const FINDINGS = 100

const files = {
  'buf.yaml': 'version: v2\nmodules:\n  - path: proto\nlint:\n  use:\n    - STANDARD\nbreaking:\n  use:\n    - FILE\n',
  'proto/acme/pet/v1/kind.proto': 'syntax = "proto3";\n\npackage acme.pet.v1;\n\nenum PetKind {\n  PET_KIND_UNSPECIFIED = 0;\n  PET_KIND_CAT = 1;\n  PET_KIND_DOG = 2;\n}\n',
  'proto/acme/pet/v1/pet.proto': 'syntax = "proto3";\n\npackage acme.pet.v1;\n\nimport "acme/pet/v1/kind.proto";\n\nmessage Pet {\n  string name = 1;\n  PetKind kind = 2;\n  int32 age = 3;\n}\n',
}
const PET = `${APP}/proto/acme/pet/v1/pet.proto`

async function kernelWithModule (dir = APP) {
  const kernel = await createNodeKernel({})
  for (const entry of await readdir(PACKAGE, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const file = join(entry.parentPath, entry.name)
    await kernel.writeFile(`/node_modules/@ai-ecoverse/wasi-buf/${relative(PACKAGE, file)}`, await readFile(file))
  }
  for (const [path, text] of Object.entries(files)) await kernel.writeFile(`${dir}/${path}`, text)
  return kernel
}

const buf = (kernel, args, cwd = APP) => kernel.run(['buf', ...args], { cwd })
const output = result => `${result.stdout}${result.stderr}`
const text = async (kernel, path) => new TextDecoder().decode(await kernel.readFile(path))
const edit = async (kernel, path, from, to) => {
  const before = await text(kernel, path)
  assert.ok(before.includes(from), `${path} contains ${from}`)
  await kernel.writeFile(path, before.replace(from, to))
}

test('buf runs and reports its version', async () => {
  const kernel = await kernelWithModule()
  try {
    const result = await buf(kernel, ['--version'])
    assert.equal(result.status, 0, output(result))
    assert.equal(result.stdout.trim(), '1.73.0')
  } finally {
    kernel.terminate()
  }
})

test('buf builds the module to an image and lists and exports its files', async () => {
  const kernel = await kernelWithModule()
  try {
    let result = await buf(kernel, ['build', '-o', 'image.binpb'])
    assert.equal(result.status, 0, output(result))
    assert.ok((await kernel.readFile(`${APP}/image.binpb`)).length > 0)
    result = await buf(kernel, ['build', '--as-file-descriptor-set', '-o', 'fds.binpb'])
    assert.equal(result.status, 0, output(result))
    result = await buf(kernel, ['ls-files'])
    assert.equal(result.status, 0, output(result))
    assert.deepEqual(result.stdout.trim().split('\n'), ['proto/acme/pet/v1/kind.proto', 'proto/acme/pet/v1/pet.proto'])
    result = await buf(kernel, ['export', '.', '-o', 'exported'])
    assert.equal(result.status, 0, output(result))
    assert.equal(await text(kernel, `${APP}/exported/acme/pet/v1/pet.proto`), files['proto/acme/pet/v1/pet.proto'])
  } finally {
    kernel.terminate()
  }
})

test('buf lint passes a clean module and reports a seeded violation with exit code 100', async () => {
  const kernel = await kernelWithModule()
  try {
    let result = await buf(kernel, ['lint'])
    assert.equal(result.status, 0, output(result))
    await edit(kernel, PET, 'message Pet {', 'message pet_record {')
    result = await buf(kernel, ['lint'])
    assert.equal(result.status, FINDINGS, output(result))
    assert.match(output(result), /proto\/acme\/pet\/v1\/pet\.proto:7:9:Message name "pet_record" should be PascalCase, such as "PetRecord"\./)
  } finally {
    kernel.terminate()
  }
})

test('buf format shows a unified diff with -d and rewrites the file with -w', async () => {
  const kernel = await kernelWithModule()
  try {
    let result = await buf(kernel, ['format', '-d', '--exit-code'])
    assert.equal(result.status, 0, output(result))
    assert.equal(result.stdout, '')
    await edit(kernel, PET, '  string name = 1;', '      string name=1;')
    result = await buf(kernel, ['format', '-d', '--exit-code'])
    assert.equal(result.status, FINDINGS, output(result))
    assert.equal(result.stdout, [
      'diff -u proto/acme/pet/v1/pet.proto.orig proto/acme/pet/v1/pet.proto',
      '--- proto/acme/pet/v1/pet.proto.orig',
      '+++ proto/acme/pet/v1/pet.proto',
      '@@ -5,7 +5,7 @@',
      ' import "acme/pet/v1/kind.proto";',
      ' ',
      ' message Pet {',
      '-      string name=1;',
      '+  string name = 1;',
      '   PetKind kind = 2;',
      '   int32 age = 3;',
      ' }',
      '',
    ].join('\n'))
    result = await buf(kernel, ['format', '-w'])
    assert.equal(result.status, 0, output(result))
    assert.equal(await text(kernel, PET), files['proto/acme/pet/v1/pet.proto'])
    result = await buf(kernel, ['format', '-d', '--exit-code'])
    assert.equal(result.status, 0, output(result))
  } finally {
    kernel.terminate()
  }
})

test('buf breaking catches a deleted field against an image and against a directory', async () => {
  const kernel = await kernelWithModule()
  try {
    for (const [path, body] of Object.entries(files)) await kernel.writeFile(`/home/previous/${path}`, body)
    let result = await buf(kernel, ['build', '-o', 'previous.binpb'])
    assert.equal(result.status, 0, output(result))
    result = await buf(kernel, ['breaking', '--against', 'previous.binpb'])
    assert.equal(result.status, 0, output(result))
    await edit(kernel, PET, '  int32 age = 3;\n', '')
    const deleted = 'Previously present field "3" with name "age" on message "Pet" was deleted.'
    result = await buf(kernel, ['breaking', '--against', 'previous.binpb'])
    assert.equal(result.status, FINDINGS, output(result))
    assert.ok(output(result).includes(deleted), output(result))
    result = await buf(kernel, ['breaking', '--against', '/home/previous'])
    assert.equal(result.status, FINDINGS, output(result))
    assert.ok(output(result).includes(deleted), output(result))
  } finally {
    kernel.terminate()
  }
})

test('buf convert turns JSON into binary and back, and into text format', async () => {
  const kernel = await kernelWithModule()
  try {
    await kernel.writeFile(`${APP}/pet.json`, '{"name":"Rex","kind":"PET_KIND_DOG","age":3}')
    let result = await buf(kernel, ['build', '-o', 'image.binpb'])
    assert.equal(result.status, 0, output(result))
    result = await buf(kernel, ['convert', 'image.binpb', '--type', 'acme.pet.v1.Pet', '--from', 'pet.json', '--to', 'pet.binpb'])
    assert.equal(result.status, 0, output(result))
    assert.deepEqual([...await kernel.readFile(`${APP}/pet.binpb`)], [0x0a, 0x03, 0x52, 0x65, 0x78, 0x10, 0x02, 0x18, 0x03])
    result = await buf(kernel, ['convert', 'image.binpb', '--type', 'acme.pet.v1.Pet', '--from', 'pet.binpb', '--to', '-#format=json'])
    assert.equal(result.status, 0, output(result))
    assert.deepEqual(JSON.parse(result.stdout), { name: 'Rex', kind: 'PET_KIND_DOG', age: 3 })
    result = await buf(kernel, ['convert', 'image.binpb', '--type', 'acme.pet.v1.Pet', '--from', 'pet.binpb', '--to', '-#format=txtpb'])
    assert.equal(result.status, 0, output(result))
    assert.equal(result.stdout.trim().replace(/\s+/g, ' '), 'name: "Rex" kind: PET_KIND_DOG age: 3')
  } finally {
    kernel.terminate()
  }
})

test('buf config init writes a buf.yaml in an empty directory', async () => {
  const kernel = await kernelWithModule()
  try {
    await kernel.writeFile('/home/fresh/.keep', '')
    const result = await buf(kernel, ['config', 'init'], '/home/fresh')
    assert.equal(result.status, 0, output(result))
    assert.match(await text(kernel, '/home/fresh/buf.yaml'), /^version: v2$/m)
  } finally {
    kernel.terminate()
  }
})

test('buf says why plugins, git inputs and the registry are unavailable', async () => {
  const kernel = await kernelWithModule()
  try {
    await kernel.writeFile(`${APP}/buf.gen.yaml`, 'version: v2\nplugins:\n  - local: protoc-gen-go\n    out: gen\n')
    let result = await buf(kernel, ['generate'])
    assert.equal(result.status, 1, output(result))
    assert.match(output(result), /plugin protoc-gen-go: exec: "protoc-gen-go": executable file not found in \$PATH/)
    result = await buf(kernel, ['breaking', '--against', '.git#branch=main'])
    assert.equal(result.status, 1, output(result))
    assert.match(output(result), /exec: "git": executable file not found in \$PATH/)
    result = await buf(kernel, ['build', 'buf.build/googleapis/googleapis'])
    assert.equal(result.status, 1, output(result))
    assert.match(output(result), /the server hosted at that remote is unavailable/)
  } finally {
    kernel.terminate()
  }
})
