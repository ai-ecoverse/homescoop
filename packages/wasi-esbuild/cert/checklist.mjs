/**
 * wasi-esbuild: bundle a multi-file TypeScript project (relative imports, a
 * tsconfig "paths" alias, a node_modules package with "exports", JSON) from
 * OPFS to a file with a sourcemap; transform stdin; fail on syntax errors and
 * unresolved imports. The project lives at /home/app, so resolution reads
 * every directory from "/" down: the command sets "preopenRoot": true, so
 * slicc-kernel >= 1.30.0 preopens "/" (0.28.2-1 patched esbuild instead).
 * A monorepo case imports through ../ and writes above the working directory.
 */
export default async function (ctx) {
  const { run, write, read, assert } = ctx;

  const ver = await run(['esbuild', '--version']);
  assert.equal(ver.status, 0, `--version stderr=${ver.stderr}`);
  assert.equal(ver.stdout, '0.28.2\n');

  await write('home/app/tsconfig.json', JSON.stringify({
    compilerOptions: { baseUrl: '.', paths: { '@lib/*': ['src/lib/*'] } },
  }));
  await write('home/app/src/index.ts', [
    "import { greet } from './greet';",
    "import { sum } from '@lib/math';",
    "import { shout } from 'shouty';",
    "import data from './data.json';",
    'export enum Mood { Happy = 1, Sad }',
    'const total: number = sum(data.values);',
    "console.log(shout(greet('slicc')), total, Mood.Sad);",
    '',
  ].join('\n'));
  await write('home/app/src/greet.ts', 'export const greet = (name: string): string => `hello ${name}`;\n');
  await write('home/app/src/lib/math.ts', 'export function sum(xs: readonly number[]): number { return xs.reduce((a, b) => a + b, 0); }\n');
  await write('home/app/src/data.json', '{ "values": [20, 22] }\n');
  await write('home/app/node_modules/shouty/package.json', JSON.stringify({
    name: 'shouty', type: 'module', exports: { '.': './dist/index.js' },
  }));
  await write('home/app/node_modules/shouty/dist/index.js', 'export const shout = (s) => s.toUpperCase() + "!";\n');

  const bundle = await run(
    ['esbuild', '--bundle', 'src/index.ts', '--outfile=dist/out.js', '--format=esm', '--minify', '--sourcemap'],
    { cwd: '/home/app' },
  );
  assert.equal(bundle.status, 0, `bundle stderr=${bundle.stderr}`);
  const out = await read('home/app/dist/out.js');
  assert.ok(out, 'dist/out.js not written');
  assert.match(out, /hello /, 'greet.ts not bundled');
  assert.match(out, /toUpperCase\(\)/, 'node_modules/shouty not bundled');
  assert.match(out, /\[20,22\]/, 'data.json not inlined');
  assert.match(out, /reduce\(/, '@lib/math (tsconfig paths) not bundled');
  assert.doesNotMatch(out, /: number|readonly number\[\]/, 'types left in the output');
  assert.doesNotMatch(out, /^import /m, 'imports left in the bundle');
  assert.match(out, /\/\/# sourceMappingURL=out\.js\.map\n$/);
  const map = JSON.parse(await read('home/app/dist/out.js.map'));
  assert.deepEqual([...map.sources].sort(), [
    '../node_modules/shouty/dist/index.js',
    '../src/data.json',
    '../src/greet.ts',
    '../src/index.ts',
    '../src/lib/math.ts',
  ]);

  // A monorepo: ../ imports out of the package, output above the working
  // directory, and an absolute entry point.
  await write('home/mono/shared/util.ts', 'export const twice = (n: number): number => n * 2;\nexport const tag = "shared-util";\n');
  await write('home/mono/packages/app/config.json', '{ "n": 21 }\n');
  await write('home/mono/packages/app/src/main.ts', [
    "import { twice, tag } from '../../../shared/util';",
    "import cfg from '../config.json';",
    'console.log(tag, twice(cfg.n));',
    '',
  ].join('\n'));
  const mono = await run(
    ['esbuild', '--bundle', 'src/main.ts', '--outfile=../../dist/app.js', '--format=esm'],
    { cwd: '/home/mono/packages/app' },
  );
  assert.equal(mono.status, 0, `monorepo bundle stderr=${mono.stderr}`);
  const app = await read('home/mono/dist/app.js');
  assert.ok(app, '../../dist/app.js not written');
  assert.match(app, /"shared-util"/, '../../../shared/util not bundled');
  assert.match(app, /n \* 2/, 'twice() not bundled');
  assert.match(app, /n: 21/, '../config.json not inlined');
  assert.doesNotMatch(app, /^import /m, 'imports left in the monorepo bundle');
  const abs = await run(['esbuild', '--bundle', '/home/mono/shared/util.ts', '--format=esm'], { cwd: '/home/mono/packages/app' });
  assert.equal(abs.status, 0, `absolute entry stderr=${abs.stderr}`);
  assert.match(abs.stdout, /"shared-util"/);

  const ts = await run(['esbuild', '--loader=ts'], { stdin: 'let x: number = 1\n' });
  assert.equal(ts.status, 0, `stdin transform stderr=${ts.stderr}`);
  assert.equal(ts.stdout, 'let x = 1;\n');

  const bad = await run(['esbuild', '--loader=ts'], { stdin: 'let x: = 1\n' });
  assert.equal(bad.status, 1, `syntax error must exit 1; stdout=${bad.stdout}`);
  assert.match(bad.stderr, /Unexpected "="/);

  await write('home/app/src/broken.ts', "import { nope } from './missing';\nconsole.log(nope);\n");
  const unresolved = await run(['esbuild', '--bundle', 'src/broken.ts', '--outfile=dist/broken.js'], { cwd: '/home/app' });
  assert.equal(unresolved.status, 1, `unresolved import must exit 1; stderr=${unresolved.stderr}`);
  assert.match(unresolved.stderr, /Could not resolve "\.\/missing"/);
  assert.equal(await read('home/app/dist/broken.js'), null, 'failed build wrote output');
}
