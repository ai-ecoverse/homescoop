/**
 * uv shim checklist (homescoop#103). The kernel in the cert harness has no
 * network, so the spec fetches pinned pure-Python wheels (sha256-checked)
 * and pip installs them with --no-index --find-links; everything else is
 * the real venv / pip / pyproject path.
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
  const env = { PIP_NO_INDEX: '1', PIP_FIND_LINKS: '/home/wheels' };
  const sh = (script, cwd = '/home') => run(['bash', '-c', script], { cwd, env });
  const ok = async (script, cwd) => {
    const r = await sh(script, cwd);
    assert.equal(r.status, 0, `${script}: rc=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    return r;
  };

  // Wheels: fetched here, checked, handed to the kernel as base64.
  await ok('mkdir -p /home/wheels');
  for (const [name, sha, url] of WHEELS) {
    const res = await fetch(url);
    assert.ok(res.ok, `fetch ${name}: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sha, `${name} sha256`);
    await write(`/home/wheels/${name}.b64`, bytes.toString('base64'));
    await ok(`base64 -d ${name}.b64 > ${name} && rm ${name}.b64`, '/home/wheels');
  }

  // --version: the shim's own version, and a note that it is not Astral's uv.
  const ver = await ok('uv --version');
  assert.match(ver.stdout, /^uv 0\.1\.0-3 \(@ai-ecoverse\/wasix-uv-shim\)$/m);
  assert.match(ver.stderr, /uv here is a shim over pip \(@ai-ecoverse\/wasix-uv-shim\), not Astral's uv/);

  // homescoop#103's "done when".
  const done = await ok(
    "mkdir -p /home/u && cd /home/u && uv venv && uv pip install requests && " +
      "uv run python -c 'import requests, sys; print(requests.__version__, sys.prefix)'",
  );
  assert.equal(done.stdout.trim().split('\n').pop(), '2.34.2 /home/u/.venv');
  assert.match(done.stderr, /Creating virtual environment at: \.venv/);
  const venvCfg = await ok('cat /home/u/.venv/pyvenv.cfg');
  assert.match(venvCfg.stdout, /^include-system-site-packages = false$/m);
  // Installed into the venv only: base python does not see it.
  const base = await sh("python -c 'import requests'", '/home/u');
  assert.notEqual(base.status, 0, 'requests leaked into the base interpreter');
  assert.match(base.stderr, /No module named 'requests'/);
  const list = await ok('uv pip list', '/home/u');
  assert.match(list.stdout, /^requests\s+2\.34\.2$/m);
  assert.match(list.stdout, /^idna\s+3\.20$/m);
  const freeze = await ok('uv pip freeze', '/home/u');
  assert.match(freeze.stdout, /^urllib3==2\.8\.0$/m);
  await ok('uv pip uninstall requests', '/home/u');
  const gone = await sh("uv run python -c 'import requests'", '/home/u');
  assert.notEqual(gone.status, 0, 'uv pip uninstall left requests');

  // uv pip with no venv anywhere: uv's message, exit 2.
  const novenv = await sh('mkdir -p /tmp/nov && cd /tmp/nov && uv pip install idna');
  assert.equal(novenv.status, 2, `no venv rc=${novenv.status}`);
  assert.match(novenv.stderr, /No virtual environment found/);

  // A project: uv init, uv add (pyproject edit + sync), uv run of a console script.
  await ok('uv init proj', '/home');
  const add = await ok('uv add idna charset-normalizer', '/home/proj');
  const toml = await ok('cat pyproject.toml', '/home/proj');
  assert.match(toml.stdout, /^dependencies = \[\n {4}"idna>=3\.20",\n {4}"charset-normalizer>=3\.5\.2",\n\]$/m, toml.stdout);
  assert.ok(!/error/i.test(add.stderr), add.stderr);
  const script = await ok('uv run normalizer --version', '/home/proj');
  assert.match(script.stdout, /^Charset-Normalizer 3\.5\.2 - Python 3\.14\.2/m);
  const main = await ok('uv run python main.py', '/home/proj');
  assert.equal(main.stdout, 'Hello from proj!\n');
  // uv sync rebuilds the environment from pyproject.toml alone.
  await ok('rm -rf .venv && uv sync -q', '/home/proj');
  const synced = await ok("uv run python -c 'import idna, sys; print(idna.__version__, sys.prefix)'", '/home/proj');
  assert.equal(synced.stdout, '3.20 /home/proj/.venv\n');
  // uv remove drops it from pyproject and the venv.
  await ok('uv remove idna', '/home/proj');
  const toml2 = await ok('cat pyproject.toml', '/home/proj');
  assert.ok(!/idna/.test(toml2.stdout), toml2.stdout);
  const removed = await sh("uv run python -c 'import idna'", '/home/proj');
  assert.notEqual(removed.status, 0, 'uv remove left idna installed');

  // Outside a project: uv add says so.
  const noproj = await sh('uv add idna', '/tmp/nov');
  assert.equal(noproj.status, 2);
  assert.match(noproj.stderr, /No `pyproject\.toml` found/);

  // Unsupported subcommands: exit 2, naming the shim.
  for (const cmd of ['lock', 'tool install ruff', 'python install 3.13', 'build', 'pip compile requirements.in']) {
    const r = await sh(`uv ${cmd}`, '/home/proj');
    assert.equal(r.status, 2, `uv ${cmd} rc=${r.status}`);
    assert.match(r.stderr, /not supported.*shim over pip/, `uv ${cmd}: ${r.stderr}`);
  }
}
