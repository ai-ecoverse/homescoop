/** wasix-openblas: the BLAS/LAPACK probe (PIC, dynamic-main). */
import { readFileSync } from 'node:fs';

// The upstream version the package says it ships (package.json's
// homescoop.upstream, which sync-package-version keeps in step with the
// recipe), so a Renovate bump needs no spec edit.
const UPSTREAM = JSON.parse(readFileSync(new URL('../package/package.json', import.meta.url), 'utf8')).homescoop.upstream;
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default async function (ctx) {
  const { run, assert } = ctx;
  assert.equal((await run(['mkdir', '-p', '/home/obprobe'])).status, 0);
  const r = await run(['obprobe-pic'], { cwd: '/home/obprobe' });
  const out = `rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`;
  assert.equal(r.status, 0, out);
  assert.match(r.stdout, /^dgemm_ 58 139 64 154$/m, out);
  assert.match(r.stdout, /^cblas_dgemm 58 64 139 154$/m, out);
  assert.match(r.stdout, /^ddot_ 32$/m, out);
  assert.match(r.stdout, /^dgesv_ info=0 x=0\.800000 1\.400000$/m, out);
  assert.match(r.stdout, /^dsyev_ info=0 w=1\.000000 3\.000000$/m, out);
  assert.match(r.stdout, /^dsyevd_ n=64 info=0 ok$/m, `divide and conquer (lapack/laed3, dlaed4_; #1173): ${out}`);
  assert.match(r.stdout, /^xerbla_ DGEMM\s+1$/m, `the program's own xerbla_ is called: ${out}`);
  assert.match(r.stdout, /^config .*RISCV64_GENERIC/m, out);
  assert.match(r.stdout, new RegExp(`^config OpenBLAS ${reEsc(UPSTREAM)} .*SINGLE_THREADED`, 'm'), `OpenBLAS ${UPSTREAM}, single-threaded (USE_THREAD=0): ${out}`);
  assert.match(r.stdout, /^obprobe ok$/m, out);
}
