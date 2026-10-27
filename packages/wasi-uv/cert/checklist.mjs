/**
 * wasi-uv checklist (homescoop#103): Astral's uv in slicc's kernel. The
 * cert kernel has no network, so the spec fetches pinned distributions
 * (sha256-checked) and uv resolves from them alone (no-index and
 * find-links in /home/uv.toml, named by UV_CONFIG_FILE on every run:
 * HOME differs between harnesses); everything else is uv's own venv /
 * pip / project path.
 */
import { createHash } from 'node:crypto';
import { detached } from './lib/detached.mjs';

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
  const env = { UV_CONFIG_FILE: '/home/uv.toml' };
  // One uv command per call: each page call has to answer within the
  // harness's 120 s, and chains of uv commands came close to it on a loaded
  // runner (homescoop#707). The step is logged first, so a timeout's
  // "crash at ?" follows the command that hung.
  const sh = (script, cwd = '/home') => {
    console.log(`wasi-uv: ${cwd}$ ${script}`);
    return run(['bash', '-c', script], { cwd, env });
  };
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

  // Resolve from /home/dists only.
  await write('/home/uv.toml', 'no-index = true\nfind-links = ["/home/dists"]\n');

  // Astral's uv, built for the kernel.
  const ver = await ok('uv --version');
  assert.match(ver.stdout, /^uv 0\.13\.2 \((?:.+ )?wasm32-wasip1-threads\)$/m);

  // Interpreter discovery: wasix-python on PATH, as a WASI platform.
  const find = await ok('uv python find && uv python list --only-installed');
  assert.match(find.stdout, /^\/usr\/bin\/python3?$/m);
  assert.match(find.stdout, /cpython-3\.14\.\d+-wasi-wasm32-none/);

  // homescoop#103's "done when".
  await ok('mkdir -p /home/u');
  const venv = await ok('uv venv', '/home/u');
  assert.match(venv.stderr, /Creating virtual environment at: \.venv/);
  const req = await ok('uv pip install requests', '/home/u');
  assert.match(req.stderr, /\+ requests==2\.34\.2/);
  const done = await ok("uv run python -c 'import requests, sys; print(requests.__version__, sys.prefix)'", '/home/u');
  assert.equal(done.stdout.trim().split('\n').pop(), '2.34.2 /home/u/.venv');
  const cfg = await ok('cat /home/u/.venv/pyvenv.cfg && ls -l /home/u/.venv/bin/python');
  assert.match(cfg.stdout, /^include-system-site-packages = false$/m);
  assert.match(cfg.stdout, /^uv = 0\.13\.2$/m);
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
  const slow = detached(ctx, { env });
  const sdistCmd = 'uv pip install --no-binary six six';
  const sdist = await slow(sdistCmd, '/home/u');
  assert.equal(sdist.status, 0, `${sdistCmd}: rc=${sdist.status}\nstdout=${sdist.stdout}\nstderr=${sdist.stderr}`);
  assert.match(sdist.stderr, /Built six==1\.17\.0/);
  const pyc = await ok('uv pip install --reinstall --compile-bytecode idna', '/home/u');
  assert.match(pyc.stderr, /Bytecode compiled \d+ files/);
  const six = await ok("uv run python -c 'import six; print(six.__version__)'", '/home/u');
  assert.match(six.stdout, /^1\.17\.0$/m);
  const cache = await ok('ls .venv/lib/python3.14/site-packages/idna/__pycache__', '/home/u');
  assert.match(cache.stdout, /\.pyc$/m);

  // A project: init, add (pyproject + uv.lock + sync + the project built by
  // uv_build), run its console script and a dependency's, lock --check,
  // remove, sync from scratch.
  await ok('uv init proj', '/home');
  await ok('uv add idna charset-normalizer', '/home/proj');
  const toml = await ok('cat pyproject.toml && test -s uv.lock', '/home/proj');
  assert.match(toml.stdout, /"idna>=3\.20"/);
  assert.match((await ok('uv run proj', '/home/proj')).stdout, /^Hello from proj!$/m);
  assert.match((await ok('uv run normalizer --version', '/home/proj')).stdout, /Charset-Normalizer 3\.5\.2/);
  assert.match((await ok("uv run python -c 'import idna; print(idna.__version__)'", '/home/proj')).stdout, /^3\.20$/m);
  const scripts = await ok('ls -l .venv/bin/proj .venv/bin/normalizer', '/home/proj');
  assert.match(scripts.stdout, /^-rwx/m, 'console scripts are executable (slicc_fs.fd_chmod)');
  await ok('uv lock --check', '/home/proj');
  await ok('uv tree', '/home/proj');
  await ok('uv remove charset-normalizer', '/home/proj');
  await ok('rm -rf .venv', '/home/proj');
  const synced = await ok('uv sync', '/home/proj');
  assert.match(synced.stderr, /\+ idna==3\.20/);
  await ok("uv run python -c 'import idna'", '/home/proj');
  const removed = await sh("uv run python -c 'import charset_normalizer'", '/home/proj');
  assert.notEqual(removed.status, 0, 'uv remove left charset-normalizer');

  // uv tool: install links the tool's executable into ~/.local/bin (the
  // unix path, a symlink), which runs; uninstall removes it.
  await ok('uv tool install charset-normalizer');
  assert.match((await ok('ls -l "$HOME/.local/bin"')).stdout, /normalizer -> .*\/tools\/charset-normalizer\/bin\/normalizer$/m);
  assert.match((await ok('"$HOME/.local/bin/normalizer" --version')).stdout, /Charset-Normalizer 3\.5\.2/);
  assert.match((await ok('uv tool list')).stdout, /^charset-normalizer v3\.5\.2$/m);
  await ok('uv tool uninstall charset-normalizer');
  await ok('test ! -e "$HOME/.local/bin/normalizer"');

  // uvx (0.13.1-4, homescoop#771): upstream's alias for uv tool run, here
  // the same uv.wasm with `tool uvx` in front. From the find-links only
  // (homescoop#674: nothing asks PyPI).
  assert.match((await ok('uvx --version')).stdout, /^uvx 0\.13\.2/m);
  const uvx = await ok('uvx --from charset-normalizer normalizer --version');
  assert.match(uvx.stdout, /Charset-Normalizer 3\.5\.2/, `uvx runs a package's command: ${uvx.stdout}`);
  assert.doesNotMatch(uvx.stderr, /pypi\.org/, `uvx resolves from the find-links: ${uvx.stderr}`);
  // homescoop#1486 (0.13.1-5): the README's uvx line, as written.
  await write('/home/u/file.txt', 'plain ascii text\n');
  const readme = await ok('uvx --from charset-normalizer normalizer file.txt', '/home/u');
  assert.match(readme.stdout, /"encoding": "ascii"/, `the README's uvx example runs: ${readme.stdout}`);

  // A version the links do not have: uv's own error, not a crash.
  const missing = await sh('uv pip install idna==0.1', '/home/u');
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /no version of idna==0\.1|idna==0\.1.*cannot be used|not found/i);
  assert.doesNotMatch(missing.stderr, /panicked|wasm trap|unreachable/);
}
