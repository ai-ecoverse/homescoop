/**
 * The wasix-python re-pin wave's cert, against the real re-pinned packages:
 * wasix-python's cert/sidemods.mjs with py-matplotlib (under test) and the
 * other py-* from this wave (meta.json needsRepack: repack-published.mjs
 * tarballs, the same bytes as their ladder-pr artifacts) installed flat in
 * /node_modules. HOMESCOOP_CERT_NO_REPIN=1 turns fixtures/repin.mjs into an
 * assertion: no py-* may resolve to another wasix-python, nothing is moved.
 */
import spec from '../../wasix-python/cert/sidemods.mjs';

export default async function (ctx) {
  process.env.HOMESCOOP_CERT_NO_REPIN = '1';
  return spec(ctx);
}
