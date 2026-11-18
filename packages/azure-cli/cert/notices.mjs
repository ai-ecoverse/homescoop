import { readFileSync } from 'node:fs';
import { checkNotices, NOTICES_FILE } from '../../../scripts/browser-cert/notices.mjs';

// homescoop#2112: THIRD-PARTY-NOTICES.md has a section with the license text
// for each distribution whose wheel ships none, as licenses.map names them,
// checked with the notices harness's own rule (a "## " heading that names it,
// its SPDX id, and a phrase of the license text). The list comes from
// licenses.map rather than meta.json "notices": these are Python
// distributions staged unmodified, not code linked into a wasm, and the
// third-party-notices test reads "notices" as linked components that a
// homescoop_notice line in build.sh must name.
// ANTLR's BSD-3-Clause text reads "Neither name of", not the usual phrase;
// scp's section is its LGPL notice, then the LGPL 2.1 itself (LGPL-2.1-or-later
// has no built-in phrase).
const TEXT = {
  'antlr4-python3-runtime': 'Neither name of copyright holders nor the names of its contributors may be used to endorse or promote products',
  scp: 'This license, the Lesser General Public License, applies to some specially designated software packages',
};

export default async function notices(ctx) {
  const { assert } = ctx;
  const map = readFileSync(new URL('../licenses.map', import.meta.url), 'utf8')
    .split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(' '));
  assert.ok(map.length >= 1, 'licenses.map lists nothing');
  const components = map.map(([name, , license]) => ({ name, license, ...(TEXT[name] ? { text: TEXT[name] } : {}) }));
  const md = await ctx.read(`/node_modules/${ctx.npmName}/${NOTICES_FILE}`);
  assert.ok(md, `${ctx.npmName} ships ${NOTICES_FILE}`);
  for (const c of components) {
    const errors = checkNotices(md, [c]);
    assert.deepEqual(errors, [], `${NOTICES_FILE}: ${errors.join('; ')}`);
  }
  console.log(`${NOTICES_FILE}: license texts for the ${components.length} distributions whose wheel ships none (${components.map((c) => `${c.name} ${c.license}`).join(', ')})`);
}
