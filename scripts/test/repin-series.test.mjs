import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accepts, repin } from '../../packages/wasix-python/cert/fixtures/repin.mjs';
import { pythonSeries } from '../check-exact-pins.mjs';

const NM = '/node_modules/@ai-ecoverse';
const SERIES = pythonSeries('3.15.0-1');

function kernel(python, deps) {
  const files = { [`${NM}/wasix-python/package.json`]: JSON.stringify({ version: python }) };
  for (const [name, spec] of Object.entries(deps)) files[`${NM}/${name}/package.json`] = JSON.stringify({ name: `@ai-ecoverse/${name}`, dependencies: { '@ai-ecoverse/wasix-python': spec } });
  return {
    read: async (p) => {
      if (!(p in files)) throw new Error(`no ${p}`);
      return files[p];
    },
    run: async (argv) => {
      const cmd = argv[2];
      if (cmd.includes('/node_modules/@ai-ecoverse/wasix-python')) return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: Object.keys(deps).map((n) => `${NM}/${n}`).join('\n') + '\n', stderr: '' };
    },
  };
}

async function strictRepin(python, deps) {
  const old = process.env.HOMESCOOP_CERT_NO_REPIN;
  process.env.HOMESCOOP_CERT_NO_REPIN = '1';
  try {
    return await repin(kernel(python, deps));
  } finally {
    if (old === undefined) delete process.env.HOMESCOOP_CERT_NO_REPIN;
    else process.env.HOMESCOOP_CERT_NO_REPIN = old;
  }
}

test('accepts: the series range holds every 3.15.Z-N from the floor through 3.15.29, the patch line only its own Z', () => {
  for (const v of ['3.15.0-1', '3.15.0-10', '3.15.2-1', '3.15.29-3']) assert.equal(accepts(SERIES, v), true, v);
  for (const v of ['3.15.0-0', '3.15.30-1', '3.16.0-1', '3.14.2-30']) assert.equal(accepts(SERIES, v), false, v);
  assert.equal(accepts('>=3.15.0-1 <3.15.1', '3.15.0-10'), true);
  assert.equal(accepts('>=3.15.0-1 <3.15.1', '3.15.2-1'), false);
  assert.equal(accepts('3.15.0-10', '3.15.0-10'), true);
});

test('repin no-repin mode: py-* on the series range pass on 3.15.0-10 and 3.15.2-1 (the B wave; main before this threw)', async () => {
  const deps = { 'py-matplotlib': SERIES, 'py-numpy': SERIES, 'py-bcrypt': pythonSeries('3.15.0-8') };
  for (const python of ['3.15.0-10', '3.15.2-1']) {
    const r = await strictRepin(python, deps);
    assert.deepEqual(r.moved, [], python);
  }
});

test('repin no-repin mode: a py-* whose range does not hold the python under test still throws', async () => {
  await assert.rejects(strictRepin('3.15.2-1', { 'py-numpy': '>=3.15.0-1 <3.15.1' }), /no-repin cert: .*py-numpy depends on wasix-python >=3\.15\.0-1 <3\.15\.1, not 3\.15\.2-1/);
  await assert.rejects(strictRepin('3.16.0-1', { 'py-numpy': SERIES }), /no-repin cert: .*py-numpy/);
});
