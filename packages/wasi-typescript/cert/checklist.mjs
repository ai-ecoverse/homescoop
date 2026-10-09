/**
 * wasi-typescript: TypeScript 7's tsc type-checks and emits a multi-file
 * project from its tsconfig.json in OPFS, resolves an @types package from
 * node_modules, reports cross-file errors with tsc's exit statuses, and
 * refuses a missing project.
 */
export default async function (ctx) {
  const { run, write, read, assert } = ctx;
  const P = 'home/proj';

  const ver = await run(['tsc', '--version']);
  assert.equal(ver.status, 0, `--version stderr=${ver.stderr}`);
  assert.equal(ver.stdout, 'Version 7.0.2\n');

  await write(`${P}/tsconfig.json`, JSON.stringify({
    compilerOptions: {
      target: 'es2022', module: 'esnext', moduleResolution: 'bundler', strict: true,
      rootDir: 'src', outDir: 'dist', declaration: true, types: ['greeter'],
    },
    include: ['src'],
  }, null, 2));
  await write(`${P}/node_modules/@types/greeter/index.d.ts`,
    'declare module "greeter" { export function greet(name: string): string; }\n');
  await write(`${P}/src/math.ts`, 'export function add(a: number, b: number): number { return a + b; }\n');
  await write(`${P}/src/shapes/area.ts`, [
    "import { add } from '../math';",
    'export interface Rect { w: number; h: number }',
    'export const perimeter = (r: Rect): number => add(r.w, r.h) * 2;',
    '',
  ].join('\n'));
  await write(`${P}/src/index.ts`, [
    "import { greet } from 'greeter';",
    "import { add } from './math';",
    "import { perimeter, type Rect } from './shapes/area';",
    'const r: Rect = { w: 2, h: 3 };',
    'export const total: number = add(perimeter(r), 1);',
    "export const hello: string = greet('slicc');",
    '',
  ].join('\n'));

  const check = await run(['tsc', '--noEmit', '-p', '.'], { cwd: `/${P}` });
  assert.equal(check.status, 0, `--noEmit stdout=${check.stdout} stderr=${check.stderr}`);
  assert.equal(check.stdout, '');
  assert.equal(await read(`${P}/dist/index.js`), null, '--noEmit wrote output');

  const emit = await run(['tsc', '-p', '.'], { cwd: `/${P}` });
  assert.equal(emit.status, 0, `emit stdout=${emit.stdout} stderr=${emit.stderr}`);
  const js = await read(`${P}/dist/index.js`);
  assert.ok(js, 'dist/index.js not written');
  assert.match(js, /^import \{ greet \} from 'greeter';$/m);
  assert.match(js, /^export const total = add\(perimeter\(r\), 1\);$/m);
  assert.doesNotMatch(js, /: Rect|: number|type Rect/, 'types left in the JS');
  const dts = await read(`${P}/dist/index.d.ts`);
  assert.match(dts, /export declare const total: number;/);
  const area = await read(`${P}/dist/shapes/area.d.ts`);
  assert.match(area, /export interface Rect/);
  assert.ok(await read(`${P}/dist/math.js`), 'dist/math.js not written');

  // A return type changed in one file breaks callers in two others.
  await write(`${P}/src/math.ts`, 'export function add(a: number, b: number): string { return `${a + b}`; }\n');
  const bad = await run(['tsc', '--noEmit', '-p', '.', '--pretty', 'false'], { cwd: `/${P}` });
  assert.equal(bad.status, 1, `type errors with --noEmit exit 1; stdout=${bad.stdout} stderr=${bad.stderr}`);
  assert.match(bad.stdout, /^src\/index\.ts\(5,14\): error TS2322: Type 'string' is not assignable to type 'number'\.$/m);
  assert.match(bad.stdout, /^src\/shapes\/area\.ts\(3,47\): error TS2362: The left-hand side of an arithmetic operation/m);
  assert.doesNotMatch(bad.stdout, /^src\/math\.ts/m, 'math.ts itself is fine');

  const badEmit = await run(['tsc', '-p', '.', '--pretty', 'false'], { cwd: `/${P}` });
  assert.equal(badEmit.status, 2, `type errors with emit exit 2; stdout=${badEmit.stdout}`);
  assert.match(await read(`${P}/dist/math.js`), /return `\$\{a \+ b\}`;/, 'emit with errors still writes output');

  const missing = await run(['tsc', '-p', '/home/nothere']);
  assert.equal(missing.status, 1, `missing project stdout=${missing.stdout}`);
  assert.match(missing.stdout + missing.stderr, /error TS5058: The specified path does not exist: '\/home\/nothere'\./);
}
