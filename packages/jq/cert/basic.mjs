/** jq checklist: arithmetic, stdin filter, bad input, version. */
export default async function (ctx) {
  const { run, assert } = ctx;

  const arith = await run(['jq', '-n', '1+1']);
  assert.equal(arith.status, 0, `arith stderr=${arith.stderr}`);
  assert.equal(arith.stdout, '2\n');

  const filter = await run(['jq', '.a'], { stdin: '{"a":41}\n' });
  assert.equal(filter.status, 0, `filter stderr=${filter.stderr}`);
  assert.equal(filter.stdout, '41\n');

  const bad = await run(['jq', '.'], { stdin: '{not json\n' });
  assert.notEqual(bad.status, 0, 'invalid JSON must fail');

  const ver = await run(['jq', '--version']);
  assert.equal(ver.status, 0);
  assert.match(ver.stdout, /^jq-/);
}
