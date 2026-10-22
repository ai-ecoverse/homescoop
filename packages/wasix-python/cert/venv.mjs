// homescoop#1269: venv.create() (whose symlinks default is False) and python
// -m venv --copies make a venv that runs. A copied bin/python ran as a bare
// wasm, without the slicc command's env and with argv[0] reduced to its name,
// so it found neither PYTHONHOME nor pyvenv.cfg ("No module named
// 'encodings'"). cpython-home-wasix.patch: on wasi venv always symlinks the
// interpreter, which resolves to the registered /usr/bin/python3.
export default async function (ctx) {
  const { run, assert } = ctx;
  const sh = async (c) => run(['bash', '-c', `set -e\n${c}`], { cwd: '/tmp' });
  const base = (await run(['python3', '-c', 'import sys; print(sys.base_prefix)'], { cwd: '/tmp' })).stdout.trim();
  const out = {};
  for (const [name, mk] of [
    ['api', 'python3 -c "import venv; venv.create(\'/tmp/vapi\')"'],
    ['copies', 'python3 -m venv --copies --without-pip /tmp/vcopies'],
    ['symlinks', 'python3 -m venv --without-pip /tmp/vlinks'],
  ]) {
    const dir = { api: '/tmp/vapi', copies: '/tmp/vcopies', symlinks: '/tmp/vlinks' }[name];
    const r = await sh(`rm -rf ${dir}; ${mk}; test -L ${dir}/bin/python; ${dir}/bin/python -c 'import sys, encodings; print(sys.prefix, sys.base_prefix, sys.prefix != sys.base_prefix)'`);
    assert.equal(r.status, 0, `${name}: rc=${r.status} ${r.stdout}${r.stderr}`);
    out[name] = r.stdout.trim();
    assert.equal(out[name], `${dir} ${base} True`, `${name}: ${out[name]}`);
  }
  const iso = await sh(`/tmp/vlinks/bin/python -I -c 'import sys, encodings; print(sys.prefix, sys.base_prefix)'`);
  assert.equal(iso.status, 0, `/tmp/vlinks/bin/python -I: rc=${iso.status} ${iso.stdout}${iso.stderr}`);
  assert.equal(iso.stdout.trim(), `/tmp/vlinks ${base}`, `/tmp/vlinks/bin/python -I: ${iso.stdout}`);
  console.log(`venv: venv.create(), --copies and the CLI default each give a symlinked bin/python, run from bash, whose sys.prefix is the venv and base_prefix ${base}; the venv's bin/python -I runs in the venv too`);
}
