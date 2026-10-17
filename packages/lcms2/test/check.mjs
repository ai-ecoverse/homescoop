import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function ({ assert, dir, stdout, version }) {
  const [maj, min] = version.split('.').map(Number);
  assert.match(stdout, new RegExp(`^lcms2 ${maj * 1000 + min * 10}$`, 'm'), 'cmsGetEncodedCMMversion is the recipe version');
  const icc = readFileSync(join(dir, 'probe.icc'));
  assert.equal(icc.readUInt32BE(0), icc.length, 'the ICC header size is the file size');
  assert.equal(icc.toString('latin1', 36, 40), 'acsp', 'ICC signature');
  assert.equal(icc.toString('latin1', 12, 16), 'mntr', 'device class display');
  assert.equal(icc.toString('latin1', 16, 20), 'RGB ', 'colour space RGB');
  assert.equal(icc.toString('latin1', 20, 24), 'XYZ ', 'PCS XYZ');
  const tags = icc.readUInt32BE(128);
  const sigs = Array.from({ length: tags }, (_, i) => icc.toString('latin1', 132 + i * 12, 136 + i * 12));
  for (const t of ['rXYZ', 'gXYZ', 'bXYZ', 'wtpt', 'rTRC']) assert.ok(sigs.includes(t), `tag ${t} in ${sigs.join(' ')}`);
}
