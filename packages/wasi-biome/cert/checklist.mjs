/**
 * wasi-biome: a SLICC project in OPFS whose biome.json extends
 * @ai-ecoverse/slicc-shared-web/biome (its real 1.10.1 config, from
 * fixtures/) through node_modules, with a .gitignore. check, format --write,
 * lint (including the type-aware nursery/noFloatingPromises across files),
 * ci, stdin formatting, a bad configuration, and what this WASI build
 * refuses with a clear message (no panic, no hang): the daemon and LSP
 * commands, --use-server, --watch and upgrade.
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
  const ciClean = await biome(['ci', '--colors=off', '.']);
  assert.equal(ciClean.status, 0, `clean ci stdout=${ciClean.stdout} stderr=${ciClean.stderr}`);
  assert.match(ciClean.stdout, /^Checked 4 files in .*\. No fixes applied\.$/m);

  // A floating promise (type-aware, across files) and an unformatted file.
  await write(`${A}/src/index.ts`, "import { load } from './fetch';\n\nexport function main(): void {\n  load('a');\n}\n");
  await write(`${A}/src/fmt.ts`, 'const greeting = "hi"\nexport const x = {a:1,b:greeting}\n');
  const dirty = await biome(['check', '.']);
  assert.equal(dirty.status, 1, `dirty check stdout=${dirty.stdout}`);
  assert.match(dirty.stdout, /Checked 5 files in .*\nFound 2 errors\./);
  assert.match(dirty.stderr, /src\/fmt\.ts format/);
  assert.match(dirty.stderr, /src\/index\.ts:4:3 lint\/nursery\/noFloatingPromises/);
  assert.doesNotMatch(dirty.stderr, /dist\/bundle\.js|node_modules/, '.gitignore not honored');
  const ciDirty = await biome(['ci', '--colors=off', '.']);
  assert.equal(ciDirty.status, 1, `dirty ci stdout=${ciDirty.stdout}`);
  assert.match(ciDirty.stdout, /Checked 5 files in .*\nFound 2 errors\./);
  assert.match(ciDirty.stderr, /src\/fmt\.ts format/);
  assert.match(ciDirty.stderr, /src\/index\.ts:4:3 lint\/nursery\/noFloatingPromises/);

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

  // Refused with a clear message, not a panic (134) or a hang: no daemon or
  // LSP (sockets, child processes), no file system events, no self-upgrade.
  const refuses = async (args, message) => {
    const r = await Promise.race([
      biome(args, { stdin: '' }),
      new Promise((resolve) => setTimeout(() => resolve({ status: 'hung', stdout: '', stderr: '' }), 60_000)),
    ]);
    assert.equal(r.status, 1, `biome ${args.join(' ')} → ${r.status} stderr=${r.stderr}`);
    assert.match(r.stderr, message, `biome ${args.join(' ')}`);
  };
  const daemon = /the Biome daemon needs sockets and child processes, which this WASI build does not have/;
  await refuses(['start'], daemon);
  await refuses(['lsp-proxy'], daemon);
  await refuses(['__run_server'], daemon);
  await refuses(['__print_socket'], daemon);
  await refuses(['check', '--use-server', '.'], /No running instance of the Biome daemon server was found/);
  const watch = /--watch needs file system events, which this WASI build does not have/;
  await refuses(['check', '--watch', '.'], watch);
  await refuses(['format', '--watch', '.'], watch);
  await refuses(['lint', '--watch', 'src'], watch);
  await refuses(['upgrade'], /`biome upgrade` is not available in the WASI build/);
  const stop = await biome(['stop']);
  assert.equal(stop.status, 0, `stop stderr=${stop.stderr}`);
  assert.match(stop.stdout, /The Biome server was not running/);

  await write(`${A}/biome.json`, '{ "formatter": { "indentWidth": "two" } }\n');
  const badConfig = await biome(['check', '.']);
  assert.equal(badConfig.status, 1);
  assert.match(badConfig.stderr, /indentWidth has an incorrect type, expected a number/);
}
