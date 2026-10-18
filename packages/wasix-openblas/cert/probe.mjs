/** wasix-openblas: the BLAS/LAPACK probe (PIC, dynamic-main). */
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
  assert.match(r.stdout, /^xerbla_ DGEMM\s+1$/m, `the program's own xerbla_ is called: ${out}`);
  assert.match(r.stdout, /^config .*RISCV64_GENERIC/m, out);
  assert.match(r.stdout, /^config OpenBLAS 0\.3\.28 .*SINGLE_THREADED/m, `single-threaded (USE_THREAD=0): ${out}`);
  assert.match(r.stdout, /^obprobe ok$/m, out);
}
