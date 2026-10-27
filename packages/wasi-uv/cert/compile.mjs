import { createHash } from 'node:crypto';

const FILES = 'https://files.pythonhosted.org/packages';
const DISTS = [
  ['requests-2.34.2-py3-none-any.whl', '2a0d60c172f83ac6ab31e4554906c0f3b3588d37b5cb939b1c061f4907e278e0',
    `${FILES}/a0/f4/c67b0b3f1b9245e8d266f0f112c500d50e5b4e83cb6f3b71b6528104182a/requests-2.34.2-py3-none-any.whl`],
  ['certifi-2026.7.22-py3-none-any.whl', '62f22742b58a1a33014a2b6b706588a8d7e2a88ae7bd1a6ebe8c992928483775',
    `${FILES}/0b/a7/71ac2cff56fec219ed242bb11b8efb69fcc4bec75db06fb7bfe35de520e6/certifi-2026.7.22-py3-none-any.whl`],
  ['charset_normalizer-3.5.2-py3-none-any.whl', 'b6b751274acb69d77b3323d6b7dbaa3c7fdfc1eb829b7eb61d262f32e1af9685',
    `${FILES}/fc/ad/d07d7862a62ffa6d79d68074d14823243dd235a77c45262acbf6adeb28bf/charset_normalizer-3.5.2-py3-none-any.whl`],
  ['idna-3.20-py3-none-any.whl', 'ab7ae7122974553370f0bdb919e1a960b2cd1bc1ef0276416d896db81c14582c',
    `${FILES}/58/a2/bb081bab032533a855d44de1d56f8e8426114ff1ba5d1f07a438a0a654f8/idna-3.20-py3-none-any.whl`],
  ['urllib3-2.8.0-py3-none-any.whl', '0cf3cae568d36aa9576b28dfb35f11328f1cb974ca7647d9475ebb86c75ac6e3',
    `${FILES}/92/9d/c4e665119135114480843e7ab388fa94d8480650450e6f8e26b70d323a4c/urllib3-2.8.0-py3-none-any.whl`],
];

const CRASH = /panicked|wasm trap|unreachable|RuntimeError/;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const env = { UV_CONFIG_FILE: '/home/uvc.toml' };
  const sh = (script, cwd = '/home/c') => {
    console.log(`wasi-uv: ${cwd}$ ${script}`);
    return run(['bash', '-c', script], { cwd, env });
  };
  const ok = async (script, cwd) => {
    const r = await sh(script, cwd);
    assert.equal(r.status, 0, `${script}: rc=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    return r;
  };
  const refused = async (script, rc, message, cwd) => {
    const r = await sh(script, cwd);
    assert.doesNotMatch(r.stderr, CRASH, `${script}: uv's error, not a panic: rc=${r.status}\nstderr=${r.stderr}`);
    assert.equal(r.status, rc, `${script}: rc=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stderr, message, `${script}: ${r.stderr}`);
    return r;
  };

  await ok('mkdir -p /home/cdists /home/c/p /home/c/linux', '/home');
  for (const [name, sha, url] of DISTS) {
    const res = await fetch(url);
    assert.ok(res.ok, `fetch ${name}: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sha, `${name} sha256`);
    await write(`/home/cdists/${name}.b64`, bytes.toString('base64'));
    await ok(`base64 -d ${name}.b64 > ${name} && rm ${name}.b64`, '/home/cdists');
  }
  await write('/home/uvc.toml', 'no-index = true\nfind-links = ["/home/cdists"]\n');
  await write('/home/c/requirements.in', 'requests\n');

  await ok('uv pip compile requirements.in -o requirements.txt');
  const pins = await ok('cat requirements.txt');
  assert.match(pins.stdout, /^requests==2\.34\.2$/m);
  assert.match(pins.stdout, /^idna==3\.20$/m);

  await refused('uv pip compile requirements.in --python-version 3.14.0.1', 2, /error: Invalid version request: 3\.14\.0\.1/);
  await refused('uv pip compile requirements.in --format pylock.toml -o /', 2, /Expected the output filename to be `pylock\.toml` or `pylock\.<name>\.toml`.*found `\/`/);

  await write('/home/c/p/pyproject.toml', [
    '[project]',
    'name = "p"',
    'version = "0.1.0"',
    'requires-python = ">=3.14"',
    'dependencies = ["idna"]',
    '',
    '[tool.uv]',
    'environments = ["sys_platform == \'wasi\'", "sys_platform == \'linux\'"]',
    '',
  ].join('\n'));
  await ok('uv export --format pylock.toml --no-header -o pylock.toml', '/home/c/p');
  const lock = await ok('cat pylock.toml', '/home/c/p');
  assert.match(lock.stdout, /^environments = \["sys_platform == 'wasi'", "sys_platform == 'linux'"\]$/m, `uv export writes the project's environments into pylock.toml: ${lock.stdout}`);
  assert.match(lock.stdout, /^name = "idna"$/m);

  await ok('uv venv -q v');
  await ok('uv pip install --python v -r p/pylock.toml');
  assert.match((await ok("v/bin/python -c 'import idna; print(idna.__version__)'")).stdout, /^3\.20$/m);

  await write('/home/c/linux/pylock.toml', lock.stdout.replace(/^environments = .*$/m, 'environments = ["sys_platform == \'linux\'"]'));
  await ok('uv venv -q w');
  await refused('uv pip install --python w -r linux/pylock.toml', 2, /The target environment is not supported by the lockfile/);
  const none = await sh("w/bin/python -c 'import idna'");
  assert.notEqual(none.status, 0, 'a pylock.toml for linux installs nothing into a wasi environment');

  await ok('uv pip install --python w --no-deps requests');
  const check = await sh('uv pip check --python w -q');
  assert.doesNotMatch(check.stderr, CRASH, check.stderr);
  assert.equal(check.status, 1, `uv pip check -q: rc=${check.status}\nstderr=${check.stderr}`);
  assert.match(check.stderr, /Found 4 incompatibilities/, `uv pip check -q names the problems: ${check.stderr}`);
  assert.match(check.stderr, /The package `requests` requires `idna[^`]*`, but it's not installed/, `uv pip check -q names the problems: ${check.stderr}`);
  console.log('compile: pip compile, pylock.toml environments (export and install), and pip check -q behave as documented since uv 0.13.2');
}
