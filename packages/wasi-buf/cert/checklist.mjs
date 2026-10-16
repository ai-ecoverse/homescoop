/**
 * wasi-buf (homescoop#488) in slicc-kernel in Chromium, as a user other than
 * root under users enforce: buf's offline commands on a small module, the
 * three protoc plugins as `local:` plugins (0005's host module starts them),
 * an image over HTTP (ctx.serve) and the errors for what seven doesn't have:
 * an unreachable registry, no git, no Docker engine (0003).
 *
 * Patches (cert/meta.json): 0001 is the build itself; 0002 is `buf format
 * -d` (an in-process unified diff, upstream runs `diff -u`); 0003 is the
 * Docker refusal; 0005 is generate, the HTTP input and the registry error.
 */
const FINDINGS = 100;
const APP = '/home/dev/app';
const files = {
  'buf.yaml': 'version: v2\nmodules:\n  - path: proto\nlint:\n  use:\n    - STANDARD\nbreaking:\n  use:\n    - FILE\n',
  'proto/acme/pet/v1/kind.proto':
    'syntax = "proto3";\n\npackage acme.pet.v1;\n\noption go_package = "example.com/acme/pet/v1;petv1";\n\nenum PetKind {\n  PET_KIND_UNSPECIFIED = 0;\n  PET_KIND_CAT = 1;\n  PET_KIND_DOG = 2;\n}\n',
  'proto/acme/pet/v1/pet.proto':
    'syntax = "proto3";\n\npackage acme.pet.v1;\n\nimport "acme/pet/v1/kind.proto";\n\noption go_package = "example.com/acme/pet/v1;petv1";\n\nmessage Pet {\n  string name = 1;\n  PetKind kind = 2;\n  int32 age = 3;\n}\n\nmessage GetPetRequest {\n  string name = 1;\n}\n\nmessage GetPetResponse {\n  Pet pet = 1;\n}\n\nservice PetService {\n  rpc GetPet(GetPetRequest) returns (GetPetResponse);\n}\n',
};
const PET = `${APP}/proto/acme/pet/v1/pet.proto`;
const DELETED = 'Previously present field "3" with name "age" on message "Pet" was deleted.';

// The image server: files.test serves what buf built in the kernel, read
// from OPFS (the kernel's filesystem). Every other host is unreachable.
async function images(req) {
  const u = new URL(req.url);
  if (u.host !== 'files.test') return { status: 502, body: 'unreachable' };
  if (u.pathname !== '/image.binpb') return { status: 404, body: 'not found' };
  let dir = await navigator.storage.getDirectory();
  for (const part of ['home', 'dev', 'app']) dir = await dir.getDirectoryHandle(part);
  const file = await (await dir.getFileHandle('previous.binpb')).getFile();
  return { headers: [['content-type', 'application/octet-stream']], body: new Uint8Array(await file.arrayBuffer()) };
}

export default async function (ctx) {
  const { run, write, read, assert, addUser, serve } = ctx;
  await addUser({ name: 'dev' });
  for (const [path, text] of Object.entries(files)) await write(`${APP}/${path}`, text);
  const buf = (args, cwd = APP) => run(['buf', ...args], { cwd, user: 'dev' });
  const out = (r) => `rc=${r.status}\n${r.stdout}${r.stderr}`;
  const edit = async (path, from, to) => {
    const before = await read(path);
    assert.ok(before.includes(from), `${path} contains ${from}`);
    await write(path, before.replace(from, to));
  };

  let r = await buf(['--version']);
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout.trim(), '1.73.0');
  for (const [plugin, version] of [
    ['protoc-gen-go', /^protoc-gen-go v1\.\d+\.\d+$/],
    ['protoc-gen-go-grpc', /^protoc-gen-go-grpc 1\.\d+\.\d+$/],
    ['protoc-gen-connect-go', /^1\.\d+\.\d+$/],
  ]) {
    const v = await run([plugin, '--version'], { cwd: APP, user: 'dev' });
    assert.equal(v.status, 0, `${plugin}: ${out(v)}`);
    assert.match(v.stdout.trim(), version, `${plugin}: ${out(v)}`);
  }

  // build, ls-files, lint: clean, then a seeded violation (exit 100).
  r = await buf(['build', '-o', 'previous.binpb']);
  assert.equal(r.status, 0, out(r));
  r = await buf(['ls-files']);
  assert.equal(r.status, 0, out(r));
  assert.deepEqual(r.stdout.trim().split('\n'), ['proto/acme/pet/v1/kind.proto', 'proto/acme/pet/v1/pet.proto']);
  r = await buf(['lint']);
  assert.equal(r.status, 0, out(r));
  await edit(PET, 'message GetPetRequest {', 'message pet_record {}\n\nmessage GetPetRequest {');
  r = await buf(['lint']);
  assert.equal(r.status, FINDINGS, out(r));
  assert.match(r.stdout + r.stderr, /pet\.proto:\d+:9:Message name "pet_record" should be PascalCase, such as "PetRecord"\./);
  await edit(PET, 'message pet_record {}\n\n', '');

  // 0002: format -d prints a unified diff in-process; -w rewrites.
  await edit(PET, '  string name = 1;', '      string name=1;');
  r = await buf(['format', '-d', '--exit-code']);
  assert.equal(r.status, FINDINGS, out(r));
  assert.ok(r.stdout.startsWith('diff -u proto/acme/pet/v1/pet.proto.orig proto/acme/pet/v1/pet.proto\n--- proto/acme/pet/v1/pet.proto.orig\n+++ proto/acme/pet/v1/pet.proto\n'), out(r));
  assert.ok(r.stdout.includes('\n-      string name=1;\n+  string name = 1;\n'), out(r));
  r = await buf(['format', '-w']);
  assert.equal(r.status, 0, out(r));
  assert.equal(await read(PET), files['proto/acme/pet/v1/pet.proto']);

  // breaking against an image and a directory.
  for (const [path, text] of Object.entries(files)) await write(`/home/dev/previous/${path}`, text);
  r = await buf(['breaking', '--against', 'previous.binpb']);
  assert.equal(r.status, 0, out(r));
  await edit(PET, '  int32 age = 3;\n', '');
  for (const against of ['previous.binpb', '/home/dev/previous']) {
    r = await buf(['breaking', '--against', against]);
    assert.equal(r.status, FINDINGS, `against ${against}: ${out(r)}`);
    assert.ok((r.stdout + r.stderr).includes(DELETED), out(r));
  }

  // 0005: an image over HTTP through the kernel's proxy, and an HTTP error.
  await serve(images);
  r = await buf(['ls-files', 'http://files.test/image.binpb']);
  assert.equal(r.status, 0, out(r));
  assert.deepEqual(r.stdout.trim().split('\n'), ['acme/pet/v1/kind.proto', 'acme/pet/v1/pet.proto']);
  r = await buf(['breaking', '--against', 'http://files.test/image.binpb']);
  assert.equal(r.status, FINDINGS, out(r));
  assert.ok((r.stdout + r.stderr).includes(DELETED), out(r));
  r = await buf(['build', 'http://files.test/missing.binpb']);
  assert.equal(r.status, 1, out(r));
  assert.match(r.stderr, /got HTTP status code 404/);
  await edit(PET, '  PetKind kind = 2;\n', '  PetKind kind = 2;\n  int32 age = 3;\n');

  // 0005: generate starts the three plugins as kernel commands.
  await write(
    `${APP}/buf.gen.yaml`,
    'version: v2\nplugins:\n  - local: protoc-gen-go\n    out: gen\n    opt: paths=source_relative\n  - local: protoc-gen-go-grpc\n    out: gen\n    opt: paths=source_relative\n  - local: protoc-gen-connect-go\n    out: gen\n    opt: paths=source_relative\n',
  );
  r = await buf(['generate']);
  assert.equal(r.status, 0, out(r));
  const pb = await read(`${APP}/gen/acme/pet/v1/pet.pb.go`);
  assert.match(pb ?? '', /^\/\/ Code generated by protoc-gen-go\. DO NOT EDIT\.$/m);
  assert.match(pb ?? '', /^package petv1$/m);
  assert.match(pb ?? '', /^type Pet struct \{$/m);
  assert.match((await read(`${APP}/gen/acme/pet/v1/kind.pb.go`)) ?? '', /PetKind_PET_KIND_DOG\s+PetKind = 2/);
  assert.match((await read(`${APP}/gen/acme/pet/v1/pet_grpc.pb.go`)) ?? '', /^type PetServiceClient interface \{$/m);
  assert.match((await read(`${APP}/gen/acme/pet/v1/petv1connect/pet.connect.go`)) ?? '', /^package petv1connect$/m);

  // What seven doesn't have: the registry, git, a Docker engine (0003).
  r = await buf(['build', 'buf.build/bufbuild/protovalidate']);
  assert.equal(r.status, 1, out(r));
  assert.match(r.stderr, /the server hosted at that remote is unavailable/);
  r = await buf(['breaking', '--against', 'https://example.invalid/pets.git#branch=main']);
  assert.equal(r.status, 1, out(r));
  assert.match(r.stderr, /exec: "git": executable file not found in \$PATH/);
  await write('/home/dev/plugin/buf.plugin.yaml', 'version: v1\nname: buf.build/acme/test\nplugin_version: v1.0.0\n');
  r = await buf(['beta', 'registry', 'plugin', 'push', '.', '--visibility', 'public', '--image', 'test:latest'], '/home/dev/plugin');
  assert.equal(r.status, 1, out(r));
  assert.match(r.stderr, /Failure: buf on wasip1 cannot reach a Docker engine/);
}
