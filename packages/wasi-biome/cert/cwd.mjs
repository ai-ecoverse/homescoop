/**
 * wasi-biome 2.6.4-2: Biome works in the process's working directory, not in
 * a stale PWD. wasi-libc's current_dir() is "/" at start whatever the cwd, so
 * 0001 changes into the real one; 2.6.4-1 took PWD as it was. A parent can set
 * a child's cwd without rewriting PWD (Node's spawnSync with { cwd }, on real
 * Node too), and @ai-ecoverse/biome-jsh runs `biome lint <basename>` that way:
 * Biome then looked for the file in the parent's directory ("No files were
 * processed in the specified paths"). Each case lints a relative file in a
 * subdirectory of a project whose biome.json extends
 * @ai-ecoverse/slicc-shared-web/biome from node_modules, so the type-aware
 * nursery/noFloatingPromises (off by default) shows that the project's
 * configuration, found from the real cwd, was applied.
 */
import { readFileSync } from 'node:fs';

const sharedWebBiome = readFileSync(new URL('./fixtures/slicc-shared-web-biome.json', import.meta.url), 'utf8');

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const P = 'home/cwd';
  const D = `/${P}/src/sub`;
  await write(`${P}/package.json`, '{\n  "name": "cwd",\n  "private": true,\n  "type": "module"\n}\n');
  await write(`${P}/biome.json`, '{\n  "extends": ["@ai-ecoverse/slicc-shared-web/biome"]\n}\n');
  await write(`${P}/node_modules/@ai-ecoverse/slicc-shared-web/package.json`,
    JSON.stringify({ name: '@ai-ecoverse/slicc-shared-web', version: '1.10.1', exports: { './biome': './biome.json' } }));
  await write(`${P}/node_modules/@ai-ecoverse/slicc-shared-web/biome.json`, sharedWebBiome);
  await write(`${P}/.git/HEAD`, 'ref: refs/heads/main\n');
  await write(`${P}/.gitignore`, 'node_modules/\n');
  await write(`${P}/src/sub/zz.ts`,
    "async function load(): Promise<string> {\n  return 'x';\n}\n\nexport function main(): void {\n  load();\n}\n");

  const linted = (label, r) => {
    const out = `${label} → ${r.status} stdout=${r.stdout} stderr=${r.stderr}`;
    assert.doesNotMatch(r.stderr, /No files were processed|provided but ignored|No such file/, out);
    assert.doesNotMatch(r.stderr, /Failed to resolve the configuration/, `extends from node_modules: ${out}`);
    assert.equal(r.status, 1, out);
    assert.match(r.stderr, /zz\.ts:6:3 lint\/nursery\/noFloatingPromises/, `the project's configuration: ${out}`);
    assert.match(r.stderr, /Checked 1 file in .*\nFound 1 error\./, out);
  };
  const lint = (opts) => run(['biome', 'lint', 'zz.ts'], { cwd: D, ...opts });

  // Node started in /tmp (PWD=/tmp) spawns biome with { cwd: D }: the child
  // inherits PWD=/tmp, as on real Node (biome-jsh's call).
  await write('tmp/biome-cwd.mjs', `
import { spawnSync } from 'node:child_process';
const D = ${JSON.stringify(D)};
const lint = (opts) => {
  const r = spawnSync('biome', ['lint', 'zz.ts'], { cwd: D, encoding: 'utf8', ...opts });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error ? String(r.error) : null };
};
const noPwd = { ...process.env };
delete noPwd.PWD;
console.log(JSON.stringify({
  pwd: process.env.PWD,
  cwd: process.cwd(),
  stale: lint({}),
  shell: spawnSync('sh', ['-c', 'biome lint zz.ts'], { cwd: D, encoding: 'utf8' }),
  noPwd: lint({ env: noPwd }),
}));
`);
  const node = await run(['node', '/tmp/biome-cwd.mjs'], { cwd: '/tmp' });
  assert.equal(node.status, 0, `node → ${node.status} stderr=${node.stderr}`);
  const got = JSON.parse(node.stdout);
  assert.equal(got.pwd, '/tmp', 'node runs with PWD=/tmp');
  assert.equal(got.cwd, '/tmp');
  assert.equal(got.stale.error, null);
  linted('node spawnSync { cwd: D }, PWD=/tmp inherited', got.stale);
  linted('node spawnSync sh -c, { cwd: D }', got.shell);
  linted('node spawnSync { cwd: D }, no PWD', got.noPwd);

  // The kernel's PWD (the cwd), as in every other spec.
  linted('PWD is the cwd', await lint());
  // PWD names another directory that exists, one that doesn't, a relative
  // path, the right directory spelt with `..`, and "/".
  linted('PWD=/tmp', await lint({ env: { PWD: '/tmp' } }));
  linted('PWD=/nonexistent', await lint({ env: { PWD: '/nonexistent' } }));
  linted('PWD=sub', await lint({ env: { PWD: 'sub' } }));
  linted('PWD with ..', await lint({ env: { PWD: `/${P}/src/../src/sub` } }));
  linted('PWD=/', await lint({ env: { PWD: '/' } }));

  // The other way round: the cwd is "/" and PWD names the project; Biome
  // looks for zz.ts in "/", as upstream Biome does with a stale PWD.
  const root = await run(['biome', 'lint', 'zz.ts'], { cwd: '/', env: { PWD: D } });
  assert.equal(root.status, 1, `cwd / PWD=${D} → ${root.status} stderr=${root.stderr}`);
  assert.doesNotMatch(root.stderr, /noFloatingPromises/, `cwd / took PWD=${D}: ${root.stderr}`);
}
