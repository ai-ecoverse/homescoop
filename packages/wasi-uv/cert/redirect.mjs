import { createHash } from 'node:crypto';

const IDNA = ['idna-3.20-py3-none-any.whl', 'ab7ae7122974553370f0bdb919e1a960b2cd1bc1ef0276416d896db81c14582c',
  'https://files.pythonhosted.org/packages/58/a2/bb081bab032533a855d44de1d56f8e8426114ff1ba5d1f07a438a0a654f8/idna-3.20-py3-none-any.whl'];

const CRASH = /panicked|wasm trap|unreachable|RuntimeError/;
export const WARNING = /^warning: Using `\.venv` redirect files is experimental and may change without warning\. Pass `--preview-features venv-redirect-files` to disable this warning\.$/m;
export const SINCE = '0.13.9';

const show = (script, r) => `${script}: rc=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`;

function notCrashed (assert, script, r) {
  assert.doesNotMatch(r.stderr, CRASH, `${show(script, r)}\nuv's own output, not a crash`);
}

export function checkPipInstall (assert, script, r) {
  notCrashed(assert, script, r);
  assert.equal(r.status, 0, `${show(script, r)}\nuv pip follows proj/.venv, a PEP 832 redirect file naming ../envs/default (uv ${SINCE}); an older uv skips a .venv that is a file and finds no virtual environment`);
  assert.match(r.stderr, WARNING, `${show(script, r)}\nuv warns that .venv redirect files are a preview feature`);
  assert.match(r.stderr, /^Using Python 3\.14\.\d+ environment at: \S*envs\/default$/m, `${show(script, r)}\nthe target is the redirect's environment`);
  assert.match(r.stderr, /^ \+ idna==3\.20$/m, `${show(script, r)}\nidna is installed`);
}

export function checkPipList (assert, script, r) {
  notCrashed(assert, script, r);
  assert.equal(r.status, 0, show(script, r));
  assert.match(r.stdout, /^idna\s+3\.20$/m, `${show(script, r)}\nuv pip list reads the redirect's environment`);
  assert.doesNotMatch(r.stderr, WARNING, `${show(script, r)}\n--preview-features venv-redirect-files silences the warning`);
}

export function checkMissingTarget (assert, script, r) {
  notCrashed(assert, script, r);
  assert.equal(r.status, 2, show(script, r));
  assert.match(r.stderr, /^error: Broken virtual environment `[^`]*proj\/missing`: missing `pyvenv\.cfg`$/m, `${show(script, r)}\na redirect to a missing environment is uv's error`);
}

export function checkSync (assert, script, r) {
  notCrashed(assert, script, r);
  assert.equal(r.status, 0, `${show(script, r)}\nuv sync uses the environment app/.venv redirects to (uv ${SINCE})`);
  assert.match(r.stderr, WARNING, `${show(script, r)}\nuv warns that .venv redirect files are a preview feature`);
  assert.match(r.stderr, /^ \+ idna==3\.20$/m, `${show(script, r)}\nidna is installed`);
}

export function checkPrefix (assert, script, r, prefix) {
  notCrashed(assert, script, r);
  assert.equal(r.status, 0, show(script, r));
  assert.equal(r.stdout.trim().split('\n').pop(), `3.20 ${prefix}`, `${show(script, r)}\nidna 3.20 imports from ${prefix}`);
}

export function checkRedirectFile (assert, script, r, text) {
  assert.equal(r.status, 0, `${show(script, r)}\nthe redirect is still a regular file, not a link or a directory`);
  assert.equal(r.stdout, text, `${show(script, r)}\nuv leaves the redirect file as it was`);
}

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const env = { UV_CONFIG_FILE: '/home/uvr.toml' };
  const sh = (script, cwd = '/home/uvr') => {
    console.log(`wasi-uv: ${cwd}$ ${script}`);
    return run(['bash', '-c', `unset VIRTUAL_ENV CONDA_PREFIX; ${script}`], { cwd, env });
  };
  const ok = async (script, cwd) => {
    const r = await sh(script, cwd);
    assert.equal(r.status, 0, show(script, r));
    return r;
  };

  await ok('mkdir -p /home/uvr/dists /home/uvr/proj/sub /home/uvr/app', '/home');
  const [name, sha, url] = IDNA;
  const res = await fetch(url);
  assert.ok(res.ok, `fetch ${name}: ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(createHash('sha256').update(bytes).digest('hex'), sha, `${name} sha256`);
  await write(`/home/uvr/dists/${name}.b64`, bytes.toString('base64'));
  await ok(`base64 -d ${name}.b64 > ${name} && rm ${name}.b64`, '/home/uvr/dists');
  await write('/home/uvr.toml', 'no-index = true\nfind-links = ["/home/uvr/dists"]\n');

  await ok('uv venv -q envs/default');
  await write('/home/uvr/proj/.venv', '../envs/default\n');
  const install = 'uv pip install idna';
  checkPipInstall(assert, install, await sh(install, '/home/uvr/proj/sub'));
  const imported = "/home/uvr/envs/default/bin/python -c 'import idna, os, sys; print(idna.__version__, os.path.realpath(sys.prefix))'";
  checkPrefix(assert, imported, await sh(imported), '/home/uvr/envs/default');
  const kept = 'test -f proj/.venv && test ! -L proj/.venv && test ! -e proj/sub/.venv && cat proj/.venv';
  checkRedirectFile(assert, kept, await sh(kept), '../envs/default\n');
  const list = 'uv pip list --preview-features venv-redirect-files';
  checkPipList(assert, list, await sh(list, '/home/uvr/proj/sub'));

  await write('/home/uvr/proj/.venv', 'missing\n');
  checkMissingTarget(assert, install, await sh(install, '/home/uvr/proj/sub'));
  const nothing = await sh('test ! -e proj/missing');
  assert.equal(nothing.status, 0, 'a redirect to a missing environment creates nothing');

  await ok('uv venv -q envs/app');
  await write('/home/uvr/app/pyproject.toml', '[project]\nname = "redirect-app"\nversion = "0.1.0"\nrequires-python = ">=3.14"\ndependencies = ["idna"]\n');
  await write('/home/uvr/app/.venv', '../envs/app\n');
  const sync = 'uv sync';
  checkSync(assert, sync, await sh(sync, '/home/uvr/app'));
  const project = "uv run python -c 'import idna, os, sys; print(idna.__version__, os.path.realpath(sys.prefix))'";
  checkPrefix(assert, project, await sh(project, '/home/uvr/app'), '/home/uvr/envs/app');
  const appKept = 'test -f app/.venv && test ! -L app/.venv && cat app/.venv';
  checkRedirectFile(assert, appKept, await sh(appKept), '../envs/app\n');
  console.log(`redirect: uv pip, uv sync and uv run follow a PEP 832 .venv redirect file (since uv ${SINCE})`);
}
