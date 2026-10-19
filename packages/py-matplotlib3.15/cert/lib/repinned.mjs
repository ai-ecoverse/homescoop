import { inPythonRange } from '../../../../scripts/check-exact-pins.mjs';

const S = '@ai-ecoverse';
const NM = `/node_modules/${S}`;

export async function assertRepinned(ctx) {
  const { run, read, assert } = ctx;
  const want = JSON.parse(await read(`${NM}/wasix-python/package.json`)).version;
  const ls = await run(['bash', '-c', `ls -d ${NM}/py-* 2>/dev/null || true`], { cwd: '/' });
  const bad = [];
  const ranged = [];
  for (const dir of ls.stdout.split('\n').filter(Boolean)) {
    const pj = JSON.parse(await read(`${dir}/package.json`));
    const dep = (pj.dependencies || {})[`${S}/wasix-python`];
    if (dep !== undefined && !inPythonRange(want, dep)) bad.push(`${pj.name}@${pj.version} takes wasix-python ${dep}`);
    if (dep !== undefined && dep !== want) ranged.push(pj.name.slice(S.length + 1));
    const nested = await run(['bash', '-c', `test -e ${dir}/node_modules/${S}/wasix-python && echo nested || true`], { cwd: '/' });
    if (nested.stdout.trim()) bad.push(`${pj.name}@${pj.version} brings a python of its own`);
  }
  assert.deepEqual(bad, [], `every py-* takes wasix-python ${want} and brings none of its own`);
  console.log(`re-pinned: every py-* takes wasix-python ${want}, ${ranged.length} of them as a range (${ranged.join(', ')}); none brings its own`);
  return want;
}
