/**
 * wasix-python 3.15.0-8: pip fails fast on homescoop-native packages
 * (numpy/scipy/pandas/matplotlib/pillow/contourpy/kiwisolver) with a
 * Python data tools / pydata hint, instead of attempting an sdist build.
 * Pure-Python installs (six) and a local wheel that only depends on numpy
 * (the formulas shape) still go through the guard; six succeeds.
 */
import { createHash } from 'node:crypto';

const SIX = [
  'six-1.17.0-py2.py3-none-any.whl',
  '4721f391ed90541fddacab5acf947aa0d3dc7d27b2e1e8eda2be8970586c3274',
  'https://files.pythonhosted.org/packages/b7/ce/149a00dd41f10bc29e5921b496af8b574d8413afcd5e30dfa0ed46c2cc5e/six-1.17.0-py2.py3-none-any.whl',
];

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const env = { PIP_NO_INDEX: '1', PIP_FIND_LINKS: '/home/pgwheels', PIP_DISABLE_PIP_VERSION_CHECK: '1' };
  const sh = (script, cwd = '/home') => run(['bash', '-c', script], { cwd, env });
  const ok = async (script, cwd) => {
    const r = await sh(script, cwd);
    assert.equal(r.status, 0, `${script}: rc=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    return r;
  };
  const fail = async (script) => {
    const r = await sh(script);
    assert.notEqual(r.status, 0, `${script}: expected non-zero, got 0\n${r.stdout}`);
    const text = `${r.stdout}\n${r.stderr}`;
    assert.match(text, /pip cannot install .+ on WASIX/, text);
    assert.match(text, /Python data tools/, text);
    assert.match(text, /\bpydata\b/, text);
    assert.match(text, /pnpm add -g @ai-ecoverse\/py-/, text);
    return text;
  };

  await ok('mkdir -p /home/pgwheels');
  const [sixName, sixSha, sixUrl] = SIX;
  const res = await fetch(sixUrl);
  assert.ok(res.ok, `fetch ${sixName}: ${res.status}`);
  const sixBytes = Buffer.from(await res.arrayBuffer());
  assert.equal(createHash('sha256').update(sixBytes).digest('hex'), sixSha, `${sixName} sha256`);
  await write(`/home/pgwheels/${sixName}.b64`, sixBytes.toString('base64'));
  await ok(`base64 -d ${sixName}.b64 > ${sixName} && rm ${sixName}.b64`, '/home/pgwheels');

  // Local wheel that depends on numpy (formulas-shaped transitive case).
  await write('/home/mkdep.py', `
import base64, hashlib, zipfile
name, ver = "hs_needs_numpy", "1.0"
di = f"{name}-{ver}.dist-info"
files = {
    f"{name}/__init__.py": "VALUE = 1\\n",
    f"{di}/METADATA": (
        f"Metadata-Version: 2.1\\nName: {name}\\nVersion: {ver}\\n"
        "Requires-Dist: numpy\\n"
    ),
    f"{di}/WHEEL": "Wheel-Version: 1.0\\nGenerator: homescoop-cert\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n",
}
record = []
with zipfile.ZipFile(f"/home/pgwheels/{name}-{ver}-py3-none-any.whl", "w") as z:
    for path, text in files.items():
        data = text.encode()
        z.writestr(path, data)
        digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
        record.append(f"{path},sha256={digest},{len(data)}")
    record.append(f"{di}/RECORD,,")
    z.writestr(f"{di}/RECORD", "\\n".join(record) + "\\n")
`);
  await ok('python3 /home/mkdep.py');

  // Direct installs: pip, pip3, python -m pip; case and extras.
  for (const cmd of [
    'pip install numpy',
    'pip3 install NumPy',
    'python3 -m pip install scipy',
    'pip install pandas pillow',
    'pip install "matplotlib[all]"',
    'pip install contourpy',
    'pip install kiwisolver',
  ]) {
    await fail(cmd);
  }

  // Transitive: a local package that Requires-Dist: numpy.
  const dep = await fail('pip install hs_needs_numpy');
  assert.match(dep, /numpy/, dep);

  // Pure-Python still works.
  const six = await ok('pip install --user six');
  assert.match(six.stdout, /Successfully installed .*six/, six.stdout);
  assert.equal(
    (await ok("python3 -c 'import six; print(six.__version__)'")).stdout.trim(),
    '1.17.0',
  );

  // Same guard inside a venv.
  await ok('python3 -m venv /home/pgv');
  await fail('/home/pgv/bin/pip install numpy');
  await ok('/home/pgv/bin/pip install six');

  console.log('pip-guard: native pydata names fail fast with a catalog hint; six and venv pip still work');
}
