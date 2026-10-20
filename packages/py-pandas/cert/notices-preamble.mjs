// homescoop#1191: THIRD-PARTY-NOTICES.md's preamble names this pandas
// version's LICENSES/ (the cp315 copy kept "pandas 2.3.2's").
export default async function (ctx) {
  const { read, assert } = ctx;
  const pj = JSON.parse(await read('/node_modules/@ai-ecoverse/py-pandas/package.json'));
  const md = await read('/node_modules/@ai-ecoverse/py-pandas/THIRD-PARTY-NOTICES.md');
  const want = `pandas ${pj.homescoop.upstream}'s LICENSES/`;
  assert.ok(md.includes(want), `preamble names ${want}`);
  assert.ok(!/pandas \d+\.\d+\.\d+'s LICENSES/.test(md.replace(want, '')), 'no other pandas version named');
  console.log(`notices-preamble (#1191): THIRD-PARTY-NOTICES.md says "${want}"`);
}
