/**
 * wasi-protoc-gen-connect-go (homescoop#488) in slicc-kernel in Chromium, as a user other than
 * root under users enforce: `protoc-gen-connect-go --version`, and `buf generate` (the
 * published @ai-ecoverse/wasi-buf) running it as a `local:` plugin on
 * test/fixtures/module. The output must be byte-for-byte test/fixtures/golden,
 * what native protoc-gen-connect-go produced from the same module.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = fileURLToPath(new URL('../test/fixtures/', import.meta.url));
const tree = (base) =>
  readdirSync(base, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(base, join(e.parentPath, e.name)))
    .sort();

export default async function (ctx) {
  const { run, write, read, assert, addUser } = ctx;
  await addUser({ name: 'dev' });
  const app = '/home/dev/app';
  const out = (r) => `rc=${r.status}\n${r.stdout}${r.stderr}`;

  const v = await run(['protoc-gen-connect-go', '--version'], { cwd: '/home/dev', user: 'dev' });
  assert.equal(v.status, 0, out(v));
  assert.equal(v.stdout.trim(), '1.21.0');

  for (const path of tree(join(fixtures, 'module'))) await write(`${app}/${path}`, readFileSync(join(fixtures, 'module', path), 'utf8'));
  await write(`${app}/buf.gen.yaml`, 'version: v2\nplugins:\n  - local: protoc-gen-connect-go\n    out: gen\n    opt: paths=source_relative\n');
  const r = await run(['buf', 'generate'], { cwd: app, user: 'dev' });
  assert.equal(r.status, 0, out(r));
  const golden = tree(join(fixtures, 'golden'));
  assert.deepEqual(golden, ["acme/pet/v1/petv1connect/pet.connect.go"]);
  for (const path of golden) {
    assert.equal(await read(`${app}/gen/${path}`), readFileSync(join(fixtures, 'golden', path), 'utf8'), `gen/${path} differs from native protoc-gen-connect-go`);
  }

  // A plugin that isn't installed says so (the check above is not vacuous).
  await write(`${app}/buf.gen.yaml`, 'version: v2\nplugins:\n  - local: protoc-gen-connect-go-missing\n    out: gen2\n');
  const missing = await run(['buf', 'generate'], { cwd: app, user: 'dev' });
  assert.equal(missing.status, 1, out(missing));
  assert.match(missing.stderr, /plugin protoc-gen-connect-go-missing: executable file not found in \$PATH/);
}
