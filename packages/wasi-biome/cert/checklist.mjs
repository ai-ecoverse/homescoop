/**
 * wasi-biome: a SLICC project in OPFS whose biome.json extends
 * @ai-ecoverse/slicc-shared-web/biome (its real 1.10.1 config, from
 * fixtures/) through node_modules, with a .gitignore. check, format --write,
 * lint (including the type-aware nursery/noFloatingPromises across files),
 * stdin formatting, a bad configuration, and the daemon and upgrade
 * commands this WASI build refuses.
 */
import { readFileSync } from 'node:fs';

const sharedWebBiome = readFileSync(new URL('./fixtures/slicc-shared-web-biome.json', import.meta.url), 'utf8');

export default async function (ctx) {
  const { run, write, read, assert } = ctx;
  const A = 'home/app';
  const biome = (args, opts = {}) => run(['biome', ...args], { cwd: `/${A}`, ...opts });

  const ver = await run(['biome', '--version']);
  assert.equal(ver.status, 0, `--version stderr=${ver.stderr}`);
  assert.match(ver.stdout, /^Version: 2\.5\.15\n/);

  await write(`${A}/package.json`, '{\n  "name": "app",\n  "private": true,\n  "type": "module"\n}\n');
  await write(`${A}/biome.json`, '{\n  "extends": ["@ai-ecoverse/slicc-shared-web/biome"]\n}\n');
  await write(`${A}/node_modules/@ai-ecoverse/slicc-shared-web/package.json`,
    JSON.stringify({ name: '@ai-ecoverse/slicc-shared-web', version: '1.10.1', exports: { './biome': './biome.json' } }));
  await write(`${A}/node_modules/@ai-ecoverse/slicc-shared-web/biome.json`, sharedWebBiome);
  await write(`${A}/.git/HEAD`, 'ref: refs/heads/main\n');
  await write(`${A}/.gitignore`, 'node_modules/\ndist/\n');
  await write(`${A}/dist/bundle.js`, 'var x = 1 == 2\n');
  await write(`${A}/src/fetch.ts`, 'export async function load(url: string): Promise<string> {\n  return `loaded ${url}`;\n}\n');
  await write(`${A}/src/index.ts`, "import { load } from './fetch';\n\nexport function main(): void {\n  void load('a');\n}\n");

  // Clean project: package.json, biome.json and two sources; dist/ is ignored.
  const clean = await biome(['check', '.']);
  assert.equal(clean.status, 0, `clean check stdout=${clean.stdout} stderr=${clean.stderr}`);
  assert.match(clean.stdout, /^Checked 4 files in \d+(\.\d+)?m?s\. No fixes applied\.$/m);

  // A floating promise (type-aware, across files) and an unformatted file.
  await write(`${A}/src/index.ts`, "import { load } from './fetch';\n\nexport function main(): void {\n  load('a');\n}\n");
  await write(`${A}/src/fmt.ts`, 'const greeting = "hi"\nexport const x = {a:1,b:greeting}\n');
  const dirty = await biome(['check', '.']);
  assert.equal(dirty.status, 1, `dirty check stdout=${dirty.stdout}`);
  assert.match(dirty.stdout, /Checked 5 files in .*\nFound 2 errors\./);
  assert.match(dirty.stderr, /src\/fmt\.ts format/);
  assert.match(dirty.stderr, /src\/index\.ts:4:3 lint\/nursery\/noFloatingPromises/);
  assert.doesNotMatch(dirty.stderr, /dist\/bundle\.js|node_modules/, '.gitignore not honored');

  const fmt = await biome(['format', '--write', '.']);
  assert.equal(fmt.status, 0, `format --write stderr=${fmt.stderr}`);
  assert.match(fmt.stdout, /^Formatted 5 files in .*\. Fixed 1 file\.$/m);
  assert.equal(await read(`${A}/src/fmt.ts`), "const greeting = 'hi';\nexport const x = { a: 1, b: greeting };\n");
  assert.equal(await read(`${A}/dist/bundle.js`), 'var x = 1 == 2\n', 'ignored file was rewritten');

  const lint = await biome(['lint', 'src']);
  assert.equal(lint.status, 1, `lint stdout=${lint.stdout}`);
  assert.match(lint.stdout, /Checked 3 files in .*\nFound 1 error\./);
  assert.match(lint.stderr, /lint\/nursery\/noFloatingPromises/);

  await write(`${A}/src/index.ts`, "import { load } from './fetch';\n\nexport function main(): void {\n  void load('a');\n}\n");
  const fixed = await biome(['check', '.']);
  assert.equal(fixed.status, 0, `check after fixes stderr=${fixed.stderr}`);

  const stdin = await biome(['format', '--stdin-file-path=src/x.ts'], { stdin: 'let a = "b"\n' });
  assert.equal(stdin.status, 0, `stdin format stderr=${stdin.stderr}`);
  assert.equal(stdin.stdout, "let a = 'b';\n");

  // No daemon (sockets, child processes) and no self-upgrade in this build.
  const start = await biome(['start']);
  assert.equal(start.status, 1);
  assert.match(start.stderr, /the Biome daemon needs sockets and child processes/);
  const server = await biome(['check', '--use-server', '.']);
  assert.equal(server.status, 1);
  assert.match(server.stderr, /No running instance of the Biome daemon server was found/);
  const upgrade = await biome(['upgrade']);
  assert.equal(upgrade.status, 1);
  assert.match(upgrade.stderr, /`biome upgrade` is not available in the WASI build/);

  await write(`${A}/biome.json`, '{ "formatter": { "indentWidth": "two" } }\n');
  const badConfig = await biome(['check', '.']);
  assert.equal(badConfig.status, 1);
  assert.match(badConfig.stderr, /indentWidth has an incorrect type, expected a number/);
}
