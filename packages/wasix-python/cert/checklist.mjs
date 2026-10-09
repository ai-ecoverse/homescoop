/**
 * wasix-python venvs (homescoop#103). sitecustomize.py gives the base
 * interpreter a sys.executable; slicc-kernel#168 passes a venv's
 * bin/python path as argv[0], so CPython finds the venv's pyvenv.cfg.
 * The cert kernel has no network: pip installs pinned wheels (sha256-
 * checked here) with --no-index --find-links.
 */
import { createHash } from 'node:crypto';

const WHEELS = [
  ['requests-2.34.2-py3-none-any.whl', '2a0d60c172f83ac6ab31e4554906c0f3b3588d37b5cb939b1c061f4907e278e0',
    'https://files.pythonhosted.org/packages/a0/f4/c67b0b3f1b9245e8d266f0f112c500d50e5b4e83cb6f3b71b6528104182a/requests-2.34.2-py3-none-any.whl'],
  ['certifi-2026.7.22-py3-none-any.whl', '62f22742b58a1a33014a2b6b706588a8d7e2a88ae7bd1a6ebe8c992928483775',
    'https://files.pythonhosted.org/packages/0b/a7/71ac2cff56fec219ed242bb11b8efb69fcc4bec75db06fb7bfe35de520e6/certifi-2026.7.22-py3-none-any.whl'],
  ['charset_normalizer-3.5.2-py3-none-any.whl', 'b6b751274acb69d77b3323d6b7dbaa3c7fdfc1eb829b7eb61d262f32e1af9685',
    'https://files.pythonhosted.org/packages/fc/ad/d07d7862a62ffa6d79d68074d14823243dd235a77c45262acbf6adeb28bf/charset_normalizer-3.5.2-py3-none-any.whl'],
  ['idna-3.20-py3-none-any.whl', 'ab7ae7122974553370f0bdb919e1a960b2cd1bc1ef0276416d896db81c14582c',
    'https://files.pythonhosted.org/packages/58/a2/bb081bab032533a855d44de1d56f8e8426114ff1ba5d1f07a438a0a654f8/idna-3.20-py3-none-any.whl'],
  ['urllib3-2.8.0-py3-none-any.whl', '0cf3cae568d36aa9576b28dfb35f11328f1cb974ca7647d9475ebb86c75ac6e3',
    'https://files.pythonhosted.org/packages/92/9d/c4e665119135114480843e7ab388fa94d8480650450e6f8e26b70d323a4c/urllib3-2.8.0-py3-none-any.whl'],
];

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const env = { PIP_NO_INDEX: '1', PIP_FIND_LINKS: '/home/wheels', PIP_DISABLE_PIP_VERSION_CHECK: '1' };
  const sh = (script, cwd = '/home') => run(['bash', '-c', script], { cwd, env });
  const ok = async (script, cwd) => {
    const r = await sh(script, cwd);
    assert.equal(r.status, 0, `${script}: rc=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    return r;
  };

  await ok('mkdir -p /home/wheels');
  for (const [name, sha, url] of WHEELS) {
    const res = await fetch(url);
    assert.ok(res.ok, `fetch ${name}: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sha, `${name} sha256`);
    await write(`/home/wheels/${name}.b64`, bytes.toString('base64'));
    await ok(`base64 -d ${name}.b64 > ${name} && rm ${name}.b64`, '/home/wheels');
  }

  // The base interpreter knows where it is.
  const info = "import sys; print(sys.executable, sys._base_executable, sys.prefix == sys.base_prefix)";
  assert.equal((await ok(`python -c '${info}'`)).stdout, '/usr/bin/python /usr/bin/python True\n');
  assert.equal((await ok(`python3 -c '${info}'`)).stdout, '/usr/bin/python3 /usr/bin/python3 True\n');

  // python -m venv, then the venv's own python (relative and absolute path).
  await ok('python -m venv v', '/home');
  const cfg = await ok('cat v/pyvenv.cfg', '/home');
  assert.match(cfg.stdout, /^include-system-site-packages = false$/m);
  const show = "import sys; print(sys.prefix, sys.executable, sys.base_prefix != sys.prefix)";
  assert.equal((await ok(`v/bin/python -c '${show}'`, '/home')).stdout, '/home/v /home/v/bin/python True\n');
  assert.equal((await ok(`/home/v/bin/python3 -c '${show}'`, '/tmp')).stdout, '/home/v /home/v/bin/python3 True\n');

  // pip from the venv installs into the venv (not --user, not the base).
  const pip = await ok('v/bin/pip install requests', '/home');
  assert.match(pip.stdout, /Successfully installed .*requests/);
  const where = await ok("v/bin/python -c 'import requests; print(requests.__file__)'", '/home');
  assert.equal(where.stdout, '/home/v/lib/python3.14/site-packages/requests/__init__.py\n');
  const user = await sh('ls /home/.local/lib/python3.14/site-packages/requests');
  assert.notEqual(user.status, 0, 'requests went to the user site');
  const base = await sh("python -c 'import requests'");
  assert.notEqual(base.status, 0, 'requests leaked into the base interpreter');
  assert.match(base.stderr, /No module named 'requests'/);
  // A console script in the venv runs with the venv's python (#!/home/v/bin/python).
  const normalizer = await ok('v/bin/normalizer --version', '/home');
  assert.match(normalizer.stdout, /^Charset-Normalizer 3\.5\.2 - Python 3\.14\.2/m);
  // Subprocesses of the venv's python stay in the venv.
  const child = await ok(
    "v/bin/python -c 'import subprocess, sys; subprocess.run([sys.executable, \"-c\", \"import requests, sys; print(sys.prefix)\"], check=True)'",
    '/home',
  );
  assert.equal(child.stdout, '/home/v\n');

  // A sitecustomize of the user's own still runs after ours.
  await ok("echo 'import builtins; builtins.HS_SITE = 1' > v/lib/python3.14/site-packages/sitecustomize.py", '/home');
  assert.equal((await ok("v/bin/python -c 'print(HS_SITE)'", '/home')).stdout, '1\n');
}
