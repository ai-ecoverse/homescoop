/**
 * The wasix-python re-pin wave's cert, against the real re-pinned packages:
 * wasix-python's cert/sidemods.mjs with py-matplotlib (under test) and the
 * other py-* from this wave (meta.json needsRepack: repack-published.mjs
 * tarballs, the same bytes as their ladder-pr artifacts) installed flat in
 * /node_modules. lib/repinned.mjs asserts first that every py-* takes the
 * python under test (exactly or as a range, homescoop#702) and brings none
 * of its own, so fixtures/repin.mjs has nothing to move.
 */
import spec from '../../wasix-python/cert/sidemods.mjs';
import { assertRepinned } from './lib/repinned.mjs';

export default async function (ctx) {
  await assertRepinned(ctx);
  return spec(ctx);
}
