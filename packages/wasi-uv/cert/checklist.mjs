/**
 * wasi-uv checklist (homescoop#103): Astral's uv in slicc's kernel. The
 * cert kernel has no network, so the spec fetches pinned distributions
 * (sha256-checked) and uv resolves from them alone (no-index and
 * find-links in the user's uv.toml); everything else is uv's own venv /
 * pip / project path.
 */
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
  ['setuptools-84.0.0-py3-none-any.whl', '51a52592b3b99e102b609654876bd65f19f999935166d1352678931132b0c670',
    `${FILES}/95/9c/c510029fc6ef33a6275cd2c5d3cecd6613dfd6aa401d57c54f1c18852ccf/setuptools-84.0.0-py3-none-any.whl`],
  ['six-1.17.0.tar.gz', 'ff70335d468e7eb6ec65b95b99d3a2836546063f63acc5171de367e834932a81',
    `${FILES}/94/e7/b2c673351809dca68a0e064b6af791aa332cf192da575fd474ed7d6f16a2/six-1.17.0.tar.gz`],
];

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const sh = (script, cwd = '/home') => run(['bash', '-c', script], { cwd });
  const ok = async (script, cwd) => {
    const r = await sh(script, cwd);
    assert.equal(r.status, 0, `${script}: rc=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    return r;
  };

  // Distributions: fetched here, checked, handed to the kernel as base64.
  await ok('mkdir -p /home/dists');
  for (const [name, sha, url] of DISTS) {
    const res = await fetch(url);
    assert.ok(res.ok, `fetch ${name}: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sha, `${name} sha256`);
    await write(`/home/dists/${name}.b64`, bytes.toString('base64'));
    await ok(`base64 -d ${name}.b64 > ${name} && rm ${name}.b64`, '/home/dists');
  }

  // Resolve from /home/dists only (user configuration).
  await write('/home/.config/uv/uv.toml', 'no-index = true\nfind-links = ["/home/dists"]\n');

  // Astral's uv, built for the kernel.
  const ver = await ok('uv --version');
  assert.match(ver.stdout, /^uv 0\.13\.1 \((?:.+ )?wasm32-wasip1-threads\)$/m);

  // Interpreter discovery: wasix-python on PATH, as a WASI platform.
  const find = await ok('uv python find && uv python list --only-installed');
  assert.match(find.stdout, /^\/usr\/bin\/python3?$/m);
  assert.match(find.stdout, /cpython-3\.14\.\d+-wasi-wasm32-none/);

  // homescoop#103's "done when".
  const done = await ok(
    "mkdir -p /home/u && cd /home/u && uv venv && uv pip install requests && " +
      "uv run python -c 'import requests, sys; print(requests.__version__, sys.prefix)'",
  );
  assert.equal(done.stdout.trim().split('\n').pop(), '2.34.2 /home/u/.venv');
  assert.match(done.stderr, /Creating virtual environment at: \.venv/);
  assert.match(done.stderr, /\+ requests==2\.34\.2/);
  const cfg = await ok('cat /home/u/.venv/pyvenv.cfg && ls -l /home/u/.venv/bin/python');
  assert.match(cfg.stdout, /^include-system-site-packages = false$/m);
  assert.match(cfg.stdout, /^uv = 0\.13\.1$/m);
  assert.match(cfg.stdout, /python -> \/usr\/bin\/python3?$/m);
  // In the venv only.
  const base = await sh("python -c 'import requests'", '/home/u');
  assert.notEqual(base.status, 0, 'requests leaked into the base interpreter');
  const list = await ok('uv pip list', '/home/u');
  assert.match(list.stdout, /^requests\s+2\.34\.2$/m);
  assert.match(list.stdout, /^idna\s+3\.20$/m);
  await ok('uv pip uninstall requests', '/home/u');
  const gone = await sh("uv run python -c 'import requests'", '/home/u');
  assert.notEqual(gone.status, 0, 'uv pip uninstall left requests');

  // An sdist: a PEP 517 build in an isolated environment (setuptools),
  // its hooks run by wasix-python over pipes; and bytecode compilation
  // (a python worker fed over stdin/stdout).
  const sdist = await ok('uv pip install --no-binary six six && uv pip install --reinstall --compile-bytecode idna', '/home/u');
  assert.match(sdist.stderr, /Built six==1\.17\.0/);
  assert.match(sdist.stderr, /Bytecode compiled \d+ files/);
  const six = await ok("uv run python -c 'import six; print(six.__version__)' && ls .venv/lib/python3.14/site-packages/idna/__pycache__", '/home/u');
  assert.match(six.stdout, /^1\.17\.0$/m);
  assert.match(six.stdout, /\.pyc$/m);

  // A project: init, add (pyproject + uv.lock + sync + the project built by
  // uv_build), run its console script and a dependency's, lock --check,
  // remove, sync from scratch.
  await ok('uv init proj', '/home');
  await ok('uv add idna charset-normalizer', '/home/proj');
  const toml = await ok('cat pyproject.toml && test -s uv.lock', '/home/proj');
  assert.match(toml.stdout, /"idna>=3\.20"/);
  const runs = await ok(
    "uv run proj && uv run normalizer --version && uv run python -c 'import idna; print(idna.__version__)'",
    '/home/proj',
  );
  assert.match(runs.stdout, /^Hello from proj!$/m);
  assert.match(runs.stdout, /Charset-Normalizer 3\.5\.2/);
  assert.match(runs.stdout, /^3\.20$/m);
  const scripts = await ok('ls -l .venv/bin/proj .venv/bin/normalizer', '/home/proj');
  assert.match(scripts.stdout, /^-rwx/m, 'console scripts are executable (slicc_fs.fd_chmod)');
  await ok('uv lock --check && uv tree', '/home/proj');
  await ok('uv remove charset-normalizer', '/home/proj');
  const synced = await ok("rm -rf .venv && uv sync && uv run python -c 'import idna'", '/home/proj');
  assert.match(synced.stderr, /\+ idna==3\.20/);
  const removed = await sh("uv run python -c 'import charset_normalizer'", '/home/proj');
  assert.notEqual(removed.status, 0, 'uv remove left charset-normalizer');

  // A version the links do not have: uv's own error, not a crash.
  const missing = await sh('uv pip install idna==0.1', '/home/u');
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /no version of idna==0\.1|idna==0\.1.*cannot be used|not found/i);
  assert.doesNotMatch(missing.stderr, /panicked|wasm trap|unreachable/);
}
