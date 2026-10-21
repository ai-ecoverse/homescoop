/**
 * Nested expressions (0.18.0-2, homescoop#1498, documented in the README).
 * tsrs recurses once per nesting level, on the browser worker's native call
 * stack (about 1 MB in V8), not its 80 MiB wasm stack: past about 800 `+`
 * terms or 550 nested parentheses it ends with a RangeError (exit 70). This
 * row keeps the depth from shrinking: a 500-term chain and 400 nested
 * parentheses type-check (rc 0), and a 3000-term chain fails with the
 * stack RangeError, not a wrong answer or a hang.
 */
export default async function (ctx) {
  const { run, write, assert } = ctx;
  const sh = (s) => run(['bash', '-c', s], { cwd: '/home/d' });
  await write('/home/d/c500.ts', 'export const w: string = ""' + ' + "x"'.repeat(500) + ';\n');
  await write('/home/d/p400.ts', 'export const v: number = ' + '('.repeat(400) + '1' + ')'.repeat(400) + ';\n');
  await write('/home/d/c3000.ts', 'export const w = ""' + ' + "x"'.repeat(3000) + ';\n');
  for (const f of ['c500.ts', 'p400.ts']) {
    const r = await sh(`tsrs --noEmit --types '' ${f}`);
    assert.equal(r.status, 0, `${f} type-checks: rc=${r.status} ${r.stdout.slice(-500)} ${r.stderr.slice(-500)}`);
  }
  const deep = await sh("tsrs --noEmit --types '' c3000.ts");
  assert.equal(deep.status, 70, `a 3000-term chain exceeds the native stack: rc=${deep.status}`);
  assert.match(deep.stderr, /Maximum call stack size exceeded/, `with the stack RangeError: ${deep.stderr.slice(0, 300)}`);
  console.log('depth: a 500-term chain and 400 nested parentheses type-check; 3000 terms end with the stack RangeError');
}
