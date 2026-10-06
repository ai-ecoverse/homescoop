// End-to-end: buf.wasm and host/buf-host.mjs on the published slicc-kernel's
// headless Node entry, against a small proto module. Network goes only to a
// local HTTP server and a local git server; nothing reaches buf.build.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createNodeKernel, nodeTransport } from '@ai-ecoverse/slicc-kernel/node'
import { startGitServer } from '../../../wasi-pnpm/test/fixtures/git-server.mjs'

const here = path => fileURLToPath(new URL(path, import.meta.url))
const PACKAGES = {
  'wasi-buf': here('../../package/'),
  'wasm-git': here('../node_modules/@ai-ecoverse/wasm-git/'),
  'test-protoc-gen-go': here('../fixtures/protoc-gen-go/package/'),
}
const APP = '/home/app'
const FINDINGS = 100

const files = {
  'buf.yaml': 'version: v2\nmodules:\n  - path: proto\nlint:\n  use:\n    - STANDARD\nbreaking:\n  use:\n    - FILE\n',
  'proto/acme/pet/v1/kind.proto': 'syntax = "proto3";\n\npackage acme.pet.v1;\n\nenum PetKind {\n  PET_KIND_UNSPECIFIED = 0;\n  PET_KIND_CAT = 1;\n  PET_KIND_DOG = 2;\n}\n',
  'proto/acme/pet/v1/pet.proto': 'syntax = "proto3";\n\npackage acme.pet.v1;\n\nimport "acme/pet/v1/kind.proto";\n\nmessage Pet {\n  string name = 1;\n  PetKind kind = 2;\n  int32 age = 3;\n}\n',
}
const PET = `${APP}/proto/acme/pet/v1/pet.proto`

async function kernelWithModule ({ dir = APP, packages = [], network = { transport: nodeTransport() } } = {}) {
  const kernel = await createNodeKernel({ network })
  for (const name of ['wasi-buf', ...packages]) {
    const base = PACKAGES[name]
    for (const entry of await readdir(base, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue
      const file = join(entry.parentPath, entry.name)
      await kernel.writeFile(`/node_modules/@ai-ecoverse/${name}/${relative(base, file)}`, await readFile(file))
    }
  }
  for (const [path, text] of Object.entries(files)) await kernel.writeFile(`${dir}/${path}`, text)
  return kernel
}

const lanAddress = () => Object.values(networkInterfaces()).flat().find(i => i?.family === 'IPv4' && !i.internal)?.address

async function serve (routes) {
  const server = createServer((req, res) => {
    const body = routes[req.url]
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/octet-stream' })
    res.end(body ?? 'not found')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) }
}

function bareRepo (root, name, contents) {
  const work = join(root, `${name}-work`)
  for (const [path, text] of Object.entries(contents)) {
    mkdirSync(dirname(join(work, path)), { recursive: true })
    writeFileSync(join(work, path), text)
  }
  const git = (args, cwd) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'ignore' })
  git(['init', '-q', '-b', 'main'], work)
  git(['add', '-A'], work)
  git(['commit', '-q', '-m', 'init'], work)
  git(['clone', '-q', '--bare', work, join(root, `${name}.git`)], root)
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

test('buf generate runs a local plugin that is a kernel command', async () => {
  const kernel = await kernelWithModule({ packages: ['test-protoc-gen-go'] })
  try {
    for (const path of ['proto/acme/pet/v1/kind.proto', 'proto/acme/pet/v1/pet.proto']) {
      await edit(kernel, `${APP}/${path}`, 'package acme.pet.v1;\n', 'package acme.pet.v1;\n\noption go_package = "example.com/acme/pet/v1;petv1";\n')
    }
    await kernel.writeFile(`${APP}/buf.gen.yaml`, 'version: v2\nplugins:\n  - local: protoc-gen-go\n    out: gen\n    opt: paths=source_relative\n')
    const result = await buf(kernel, ['generate'])
    assert.equal(result.status, 0, output(result))
    const generated = await text(kernel, `${APP}/gen/acme/pet/v1/pet.pb.go`)
    assert.match(generated, /^\/\/ Code generated by protoc-gen-go\. DO NOT EDIT\.$/m)
    assert.match(generated, /^package petv1$/m)
    assert.match(generated, /^type Pet struct \{$/m)
    assert.match(await text(kernel, `${APP}/gen/acme/pet/v1/kind.pb.go`), /PetKind_PET_KIND_DOG\s+PetKind = 2/)
  } finally {
    kernel.terminate()
  }
})

test('buf generate says when a local plugin is not installed', async () => {
  const kernel = await kernelWithModule()
  try {
    await kernel.writeFile(`${APP}/buf.gen.yaml`, 'version: v2\nplugins:\n  - local: protoc-gen-go\n    out: gen\n')
    const result = await buf(kernel, ['generate'])
    assert.equal(result.status, 1, output(result))
    assert.match(output(result), /plugin protoc-gen-go: executable file not found in \$PATH/)
  } finally {
    kernel.terminate()
  }
})

test('buf reads an image over HTTP and reports an HTTP error', async () => {
  const kernel = await kernelWithModule()
  let server
  try {
    let result = await buf(kernel, ['build', '-o', 'image.binpb'])
    assert.equal(result.status, 0, output(result))
    server = await serve({ '/image.binpb': Buffer.from(await kernel.readFile(`${APP}/image.binpb`)) })
    result = await buf(kernel, ['ls-files', `${server.base}/image.binpb`])
    assert.equal(result.status, 0, output(result))
    assert.deepEqual(result.stdout.trim().split('\n'), ['acme/pet/v1/kind.proto', 'acme/pet/v1/pet.proto'])
    await edit(kernel, PET, '  int32 age = 3;\n', '')
    result = await buf(kernel, ['breaking', '--against', `${server.base}/image.binpb`])
    assert.equal(result.status, FINDINGS, output(result))
    assert.ok(output(result).includes('Previously present field "3" with name "age" on message "Pet" was deleted.'), output(result))
    result = await buf(kernel, ['build', `${server.base}/missing.binpb`])
    assert.equal(result.status, 1, output(result))
    assert.match(output(result), /got HTTP status code 404/)
  } finally {
    kernel.terminate()
    await server?.close()
  }
})

test('buf reports an unreachable registry', async () => {
  const transport = nodeTransport()
  const offline = { traits: transport.traits, fetch: () => Promise.reject(Object.assign(new Error('offline'), { code: 'ECONNREFUSED' })) }
  const kernel = await kernelWithModule({ network: { transport: offline } })
  try {
    const result = await buf(kernel, ['build', 'buf.build/bufbuild/protovalidate'])
    assert.equal(result.status, 1, output(result))
    assert.match(output(result), /the server hosted at that remote is unavailable/)
  } finally {
    kernel.terminate()
  }
})

test('buf reads a git input over smart HTTP through wasm-git', async () => {
  const host = lanAddress()
  assert.ok(host, 'a non-loopback IPv4 address for the realm proxy (it refuses loopback)')
  const server = await startGitServer({ host })
  bareRepo(server.root, 'pets', files)
  const kernel = await kernelWithModule({ packages: ['wasm-git'] })
  try {
    const url = `${server.base}pets.git#branch=main`
    let result = await buf(kernel, ['ls-files', url])
    assert.equal(result.status, 0, output(result))
    assert.deepEqual(result.stdout.trim().split('\n'), ['proto/acme/pet/v1/kind.proto', 'proto/acme/pet/v1/pet.proto'])
    await edit(kernel, PET, '  int32 age = 3;\n', '')
    result = await buf(kernel, ['breaking', '--against', url])
    assert.equal(result.status, FINDINGS, output(result))
    assert.ok(output(result).includes('Previously present field "3" with name "age" on message "Pet" was deleted.'), output(result))
  } finally {
    kernel.terminate()
    await server.close()
  }
})

test('buf says when git is not installed', async () => {
  const kernel = await kernelWithModule()
  try {
    const result = await buf(kernel, ['breaking', '--against', 'https://example.invalid/pets.git#branch=main'])
    assert.equal(result.status, 1, output(result))
    assert.match(output(result), /exec: "git": executable file not found in \$PATH/)
  } finally {
    kernel.terminate()
  }
})
