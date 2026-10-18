/** wasix-f2c: a Fortran 77 program through bin/gfortran, run in the kernel. */
export default async function (ctx) {
  const { run, assert } = ctx;
  assert.equal((await run(['mkdir', '-p', '/home/fprobe'])).status, 0);
  const r = await run(['fprobe-pic'], { cwd: '/home/fprobe' });
  const out = `rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`;
  assert.equal(r.status, 0, out);
  assert.match(r.stdout, /^ saxpy\s+3\.\s+5\.\s+7\.\s+9\.\s*$/m, out);
  assert.match(r.stdout, /^snrm\s+5\.4772$/m, out);
  assert.match(r.stdout, /^dpow\s+1024\.0$/m, out);
  assert.match(r.stdout, /^concat wasix-f2c\s*$/m, out);
  assert.match(r.stdout, /^fprobe ok$/m, out);
}
