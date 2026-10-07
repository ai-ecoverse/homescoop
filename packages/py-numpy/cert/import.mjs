/** NumPy checklist (slicc-kernel + wasix-python). Runs when tarball+wasix-python are installable. */
export default async function (ctx) {
  const { run, assert } = ctx;
  const env = {
    PYTHONPATH: '/node_modules/@ai-ecoverse/py-numpy/lib/python3.14/site-packages',
  };
  const r = await run(
    [
      'python3',
      '-c',
      'import numpy as np; print(np.arange(6).reshape(2,3).sum(axis=0).tolist())',
    ],
    { cwd: '/home', env },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '[3, 5, 7]\n');
}
