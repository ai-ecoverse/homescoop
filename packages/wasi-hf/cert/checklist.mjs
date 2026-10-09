/**
 * wasi-hf checklist (homescoop#110). ctx.serve() fakes the Hub behind the
 * kernel's realm proxy (absolute-form https, no CONNECT, no wasm-tls-engine):
 *   https://hub.test (and https://huggingface.co, the default endpoint) as a
 *     manual-redirect transport delivers it: resolve answers 307 to
 *     /api/resolve-cache (small files) or 302 to https://cdn.test (LFS);
 *   https://follow.test as a transport that follows redirects delivers it:
 *     resolve answers the body itself, with no redirect;
 *   https://cdn.test: LFS bytes, Range → 206; a request carrying
 *     Authorization is refused (the token must not leave the Hub).
 * Bodies honour Range everywhere. window.hfLog records every request.
 */
import { createHash } from 'node:crypto';

const A = '1a2b3c4d5e6f708192a3b4c5d6e7f80910a1b2c3';
const B = 'b1b2b3b4b5b6b7b8b9c0c1c2c3c4c5c6c7c8c9d0';

// Same bytes as the responder's (it must be self-contained).
const content = (seed, n) => {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + seed * 17 + (i >> 9) * 7) & 255;
  return b;
};
const sha = (b) => createHash('sha256').update(b).digest('hex');

async function responder(req) {
  const A = '1a2b3c4d5e6f708192a3b4c5d6e7f80910a1b2c3';
  const B = 'b1b2b3b4b5b6b7b8b9c0c1c2c3c4c5c6c7c8c9d0';
  const gen = (seed, n) => {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = (i * 31 + seed * 17 + (i >> 9) * 7) & 255;
    return b;
  };
  const text = (s) => new TextEncoder().encode(s);
  const hex = async (b) =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const u = new URL(req.url);
  const hdr = (n) => (req.headers.find(([k]) => k.toLowerCase() === n) || [])[1] || '';
  window.hfLog = window.hfLog || [];
  window.hfLog.push({ host: u.host, path: u.pathname, search: u.search, range: hdr('range'), auth: hdr('authorization') });
  const json = (v, status = 200, extra = []) => ({
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: [['content-type', 'application/json'], ...extra],
    body: JSON.stringify(v),
  });
  const err = (status, message) => json({ error: message }, status, [['x-error-message', message]]);

  // repo → commit → path → { body, lfs?, corrupt? }
  const tiny = {
    '.gitattributes': { body: text('*.onnx filter=lfs diff=lfs merge=lfs -text\n') },
    'config.json': { body: text('{"model_type":"cert"}\n') },
    'onnx/model.onnx': { body: gen(1, 300000), lfs: true },
    'weights.bin': { body: gen(2, 200000), lfs: true },
    'tf_model.h5': { body: gen(3, 50000), lfs: true },
    'sub dir/notes+1.txt': { body: text('notes with a space and a plus\n') },
  };
  const repos = {
    'models/cert/tiny': {
      refs: { main: A, v1: B, 'refs/pr/1': B },
      commits: {
        [A]: tiny,
        [B]: { 'config.json': { body: text('{"v":1}\n') }, 'onnx/model.onnx': tiny['onnx/model.onnx'] },
      },
    },
    'models/cert/paged': {
      refs: { main: A },
      commits: { [A]: { 'a.txt': { body: text('page one\n') }, 'b.txt': { body: text('page two\n') } } },
      paged: true,
    },
    'models/cert/gated': {
      refs: { main: A },
      commits: { [A]: { 'secret.bin': { body: gen(4, 40000), lfs: true } } },
      gated: true,
    },
    'models/cert/corrupt': {
      refs: { main: A },
      commits: { [A]: { 'bad.bin': { body: gen(5, 30000), lfs: true, corrupt: true } } },
    },
    'models/cert/flaky': {
      refs: { main: A },
      commits: { [A]: { 'big.bin': { body: gen(6, 300000), lfs: true, flaky: true } } },
    },
    'datasets/cert-data/set': {
      refs: { main: A },
      commits: { [A]: { 'data.csv': { body: text('a,b\n1,2\n') } } },
    },
  };

  const authorized = hdr('authorization') === 'Bearer hf_good';
  const ranged = (body, extra = []) => {
    const m = /^bytes=(\d+)-$/.exec(hdr('range'));
    if (!m) {
      return { status: 200, headers: [['content-type', 'application/octet-stream'], ['accept-ranges', 'bytes'], ...extra], body };
    }
    const start = Number(m[1]);
    if (start >= body.length) return { status: 416, statusText: 'Range Not Satisfiable', headers: [['content-range', `bytes */${body.length}`]], body: '' };
    return {
      status: 206,
      statusText: 'Partial Content',
      headers: [['content-type', 'application/octet-stream'], ['content-range', `bytes ${start}-${body.length - 1}/${body.length}`], ...extra],
      body: body.slice(start),
    };
  };
  const served = (file) => {
    if (file.corrupt) {
      const b = file.body.slice();
      b[1234] ^= 0xff;
      return b;
    }
    // The first plain GET of a flaky file ends halfway, as a cut connection would.
    if (file.flaky && !hdr('range') && !window.hfFlakyCut) {
      window.hfFlakyCut = true;
      return file.body.slice(0, 150000);
    }
    return file.body;
  };

  if (u.host === 'cdn.test') {
    if (hdr('authorization')) return { status: 400, statusText: 'Bad Request', body: 'Authorization must not reach the CDN\n' };
    const [, , kind, owner, name, commit, ...rest] = u.pathname.split('/');
    const file = repos[`${kind}/${owner}/${name}`]?.commits[commit]?.[decodeURIComponent(rest.join('/'))];
    if (!file || u.searchParams.get('sig') !== 'ok') return { status: 403, statusText: 'Forbidden', body: 'bad signature\n' };
    return ranged(served(file), [['etag', `"${await hex(file.body)}"`]]);
  }
  if (!['hub.test', 'follow.test', 'huggingface.co'].includes(u.host)) return { status: 502, statusText: 'Bad Gateway', body: 'unknown host\n' };
  const follow = u.host === 'follow.test';
  const p = u.pathname;

  if (p === '/api/whoami-v2') {
    return authorized ? json({ type: 'user', name: 'cert-user', orgs: [{ name: 'cert-org' }] }) : err(401, 'Invalid credentials in Authorization header');
  }
  let m = /^\/api\/(models|datasets|spaces)\/([^/]+)\/([^/]+)\/(revision|tree)\/([^/]+)$/.exec(p);
  if (m) {
    const [, kind, owner, name, what, ref] = m;
    const repo = repos[`${kind}/${owner}/${name}`];
    if (!repo || (repo.gated && !authorized)) {
      return repo ? err(401, `Access to model ${owner}/${name} is restricted.`) : err(404, 'Repository not found');
    }
    if (what === 'revision') {
      const commit = repo.refs[decodeURIComponent(ref)];
      return commit ? json({ id: `${owner}/${name}`, sha: commit }) : err(404, `Invalid rev id: ${decodeURIComponent(ref)}`);
    }
    const files = repo.commits[ref];
    if (!files || u.searchParams.get('recursive') !== 'true') return err(404, 'bad tree request');
    const list = [];
    const dirs = new Set();
    for (const [path, f] of Object.entries(files)) {
      if (path.includes('/')) dirs.add(path.slice(0, path.lastIndexOf('/')));
      const e = { type: 'file', oid: 'f'.repeat(40), size: f.body.length, path };
      if (f.lfs) e.lfs = { oid: await hex(f.body), size: f.body.length, pointerSize: 134 };
      list.push(e);
    }
    for (const d of dirs) list.unshift({ type: 'directory', oid: 'd'.repeat(40), size: 0, path: d });
    if (repo.paged) {
      const page = u.searchParams.get('cursor') === 'p2' ? list.slice(1) : list.slice(0, 1);
      const extra = u.searchParams.get('cursor') ? [] : [['link', `<https://${u.host}${p}?recursive=true&expand=false&cursor=p2>; rel="next"`]];
      return json(page, 200, extra);
    }
    return json(list);
  }
  m = /^\/api\/resolve-cache\/(models|datasets|spaces)\/([^/]+)\/([^/]+)\/([0-9a-f]{40})\/(.+)$/.exec(p);
  if (m) {
    const [, kind, owner, name, commit, path] = m;
    const file = repos[`${kind}/${owner}/${name}`]?.commits[commit]?.[decodeURIComponent(path)];
    return file ? ranged(served(file), [['x-repo-commit', commit]]) : err(404, 'Entry not found');
  }
  m = /^\/(?:(datasets|spaces)\/)?([^/]+)\/([^/]+)\/resolve\/([0-9a-f]{40})\/(.+)$/.exec(p);
  if (m) {
    const [, kindMatch, owner, name, commit, path] = m;
    const kind = kindMatch || 'models';
    const repo = repos[`${kind}/${owner}/${name}`];
    if (!repo) return err(404, 'Repository not found');
    if (repo.gated && !authorized) return err(401, `Access to model ${owner}/${name} is restricted.`);
    const file = repo.commits[commit]?.[decodeURIComponent(path)];
    if (!file) return err(404, 'Entry not found');
    const meta = [['x-repo-commit', commit], ['x-linked-size', String(file.body.length)]];
    if (follow) return ranged(served(file));
    if (file.lfs) {
      return { status: 302, statusText: 'Found', headers: [['location', `https://cdn.test/blob/${kind}/${owner}/${name}/${commit}/${path}?sig=ok`], ...meta], body: '' };
    }
    return { status: 307, statusText: 'Temporary Redirect', headers: [['location', `/api/resolve-cache/${kind}/${owner}/${name}/${commit}/${path}`], ...meta], body: '' };
  }
  return err(404, `no route ${p}`);
}

export default async function (ctx) {
  const { run, serve, assert, page } = ctx;
  await serve(responder);
  const cwd = '/home/proj';
  const HUB = { HF_ENDPOINT: 'https://hub.test' };
  const FOLLOW = { HF_ENDPOINT: 'https://follow.test' };
  const go = (argv, env = HUB, stdin) => run(argv, { cwd, env, stdin });
  const out = (r) => `rc=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`;
  const ok = async (argv, env, stdin) => {
    const r = await go(argv, env, stdin);
    assert.equal(r.status, 0, `${argv.join(' ')}: ${out(r)}`);
    return r;
  };
  const sh = (script, env = HUB) => ok(['bash', '-c', script], env);
  const log = () => page.evaluate(() => (window.hfLog || []).splice(0));
  const sums = async (dir, files) => {
    const r = await ok(['sha256sum', ...files.map((f) => `${dir}/${f}`)]);
    return r.stdout;
  };
  const sumLine = (dir, f, bytes) => `${sha(bytes)}  ${dir}/${f}\n`;
  const noLeftovers = async (dir) => {
    const r = await sh(`shopt -s globstar dotglob nullglob; for f in ${dir}/**; do if [ -L "$f" ]; then echo "LINK $f"; fi; case "$f" in *.incomplete) echo "PART $f";; esac; done; true`);
    assert.equal(r.stdout, '', `symlinks or .incomplete files under ${dir}:\n${r.stdout}`);
  };
  await run(['mkdir', '-p', cwd], { cwd: '/home' });

  const onnx = content(1, 300000);
  const weights = content(2, 200000);

  // Version, help, the subset.
  assert.match((await ok(['hf', '--version'])).stdout, /^hf 0\.1\.0 \(@ai-ecoverse\/wasi-hf/);
  assert.match((await ok(['hf', '--help'])).stdout, /hf download <repo>/);
  assert.match((await ok(['hf', 'download', '--help'])).stdout, /--revision REV/);
  const upload = await go(['hf', 'upload', 'me/x', 'f']);
  assert.equal(upload.status, 2, out(upload));
  assert.match(upload.stderr, /'upload' is not in this build/);
  const badId = await go(['hf', 'download', 'not-a-repo']);
  assert.equal(badId.status, 2, out(badId));
  await log();

  // Manual redirects: whole repo minus *.h5 into /home/models/<owner>/<name>.
  const D = '/home/models/cert/tiny';
  const first = await ok(['hf', 'download', 'cert/tiny', '--exclude', '*.h5']);
  assert.equal(first.stdout, `${D}\n`);
  assert.match(first.stderr, /5 file\(s\), .* in cert\/tiny@main \(1a2b3c4d5e6f\)/);
  assert.match(first.stderr, /5 downloaded, 0 skipped/);
  assert.equal(
    await sums(D, ['onnx/model.onnx', 'weights.bin']),
    sumLine(D, 'onnx/model.onnx', onnx) + sumLine(D, 'weights.bin', weights),
  );
  assert.equal((await ok(['cat', `${D}/config.json`])).stdout, '{"model_type":"cert"}\n');
  assert.equal((await ok(['cat', `${D}/sub dir/notes+1.txt`])).stdout, 'notes with a space and a plus\n');
  assert.equal((await go(['test', '-e', `${D}/tf_model.h5`])).status, 1, '--exclude *.h5 still downloaded tf_model.h5');
  await noLeftovers(D);
  let l = await log();
  assert.ok(l.some((r) => r.host === 'cdn.test' && r.path.endsWith('/onnx/model.onnx')), 'LFS file did not come from the CDN');
  assert.ok(l.some((r) => r.path.startsWith('/api/resolve-cache/') && r.path.endsWith('/config.json')), 'small file did not follow the 307');
  assert.ok(l.some((r) => r.path === `/cert/tiny/resolve/${A}/sub%20dir/notes%2B1.txt`), 'path not percent-encoded');
  assert.ok(l.every((r) => !r.auth), 'sent Authorization without a token');

  // Present files are skipped; --force fetches again.
  const again = await ok(['hf', 'download', 'cert/tiny', '--exclude', '*.h5']);
  assert.match(again.stderr, /0 downloaded, 5 skipped/);
  assert.ok((await log()).every((r) => !r.path.includes('/resolve/')), 'skipped files were requested');
  const forced = await ok(['hf', 'download', 'cert/tiny', 'config.json', '--force', '-j', '1']);
  assert.match(forced.stderr, /1 downloaded, 0 skipped/);
  await log();

  // A transport that follows redirects: bodies come straight from resolve.
  const follow = await ok(['hf', 'download', 'cert/tiny', '--include', '*.onnx', '--include', '*.json', '--to', 'out-follow'], FOLLOW);
  assert.equal(follow.stdout, `${cwd}/out-follow\n`, 'relative --to is not under the cwd');
  assert.equal(await sums(`${cwd}/out-follow`, ['onnx/model.onnx']), sumLine(`${cwd}/out-follow`, 'onnx/model.onnx', onnx));
  assert.equal((await go(['test', '-e', `${cwd}/out-follow/weights.bin`])).status, 1, '--include let weights.bin through');
  l = await log();
  assert.ok(l.length > 0 && l.every((r) => r.host === 'follow.test'), 'follow mode left follow.test');

  // Resume from <file>.incomplete with Range, on both transports.
  for (const [env, label, host] of [[HUB, 'manual', 'cdn.test'], [FOLLOW, 'follow', 'follow.test']]) {
    const R = `/home/resume-${label}`;
    await sh(`mkdir -p ${R}/onnx && head -c 100000 ${D}/onnx/model.onnx > ${R}/onnx/model.onnx.incomplete`, env);
    const r = await ok(['hf', 'download', 'cert/tiny', 'onnx/model.onnx', '--to', R], env);
    assert.match(r.stderr, /onnx\/model\.onnx: resuming at 97\.7 KiB/, `${label}: ${out(r)}`);
    assert.equal(await sums(R, ['onnx/model.onnx']), sumLine(R, 'onnx/model.onnx', onnx), `${label}: resumed file corrupt`);
    await noLeftovers(R);
    const rl = await log();
    assert.ok(rl.some((x) => x.host === host && x.range === 'bytes=100000-'), `${label}: no Range request reached ${host}`);
    assert.ok(!rl.some((x) => x.path.endsWith('/onnx/model.onnx') && !x.range), `${label}: resumed with a full download`);
  }

  // A wrong prefix is caught by the sha256 and downloaded again from 0.
  await sh(`mkdir -p /home/badpart/onnx && head -c 100000 ${D}/weights.bin > /home/badpart/onnx/model.onnx.incomplete`);
  const bad = await ok(['hf', 'download', 'cert/tiny', 'onnx/model.onnx', '--to', '/home/badpart']);
  assert.match(bad.stderr, /sha256 mismatch; downloading it again from the start/);
  assert.equal(await sums('/home/badpart', ['onnx/model.onnx']), sumLine('/home/badpart', 'onnx/model.onnx', onnx));
  l = await log();
  assert.ok(l.some((x) => x.host === 'cdn.test' && x.range === 'bytes=100000-') && l.some((x) => x.host === 'cdn.test' && !x.range));

  // A body cut short mid-download resumes in the same run.
  const flaky = await ok(['hf', 'download', 'cert/flaky']);
  assert.match(flaky.stderr, /big\.bin: (got 150000 of 300000 bytes|connection lost)/, out(flaky));
  assert.match(flaky.stderr, /big\.bin: resuming at 146\.5 KiB/);
  assert.equal(await sums('/home/models/cert/flaky', ['big.bin']), sumLine('/home/models/cert/flaky', 'big.bin', content(6, 300000)));
  assert.ok((await log()).some((x) => x.host === 'cdn.test' && x.range === 'bytes=150000-'));

  // An LFS file that does not match its sha256 fails and leaves nothing.
  const corrupt = await go(['hf', 'download', 'cert/corrupt']);
  assert.equal(corrupt.status, 1, out(corrupt));
  assert.match(corrupt.stderr, /failed bad\.bin: sha256 mismatch/);
  assert.equal((await go(['test', '-e', '/home/models/cert/corrupt/bad.bin'])).status, 1);
  await noLeftovers('/home/models/cert/corrupt');

  // Revisions, pagination, datasets, the default endpoint.
  await ok(['hf', 'download', 'cert/tiny', 'config.json', '--revision', 'v1', '--to', '/home/rev']);
  assert.equal((await ok(['cat', '/home/rev/config.json'])).stdout, '{"v":1}\n');
  await ok(['hf', 'download', 'cert/tiny', 'config.json', '--revision', 'refs/pr/1', '--to', '/home/rev-pr']);
  l = await log();
  assert.ok(l.some((x) => x.path === '/api/models/cert/tiny/revision/refs%2Fpr%2F1'), 'revision not encoded');
  assert.ok(l.some((x) => x.path === `/cert/tiny/resolve/${B}/config.json`), 'file not fetched at the pinned commit');
  await ok(['hf', 'download', 'cert/paged', '--to', '/home/paged']);
  assert.equal((await ok(['cat', '/home/paged/a.txt', '/home/paged/b.txt'])).stdout, 'page one\npage two\n');
  assert.ok((await log()).some((x) => x.search.includes('cursor=p2')), 'second tree page not fetched');
  const ds = await ok(['hf', 'download', 'datasets/cert-data/set']);
  assert.equal(ds.stdout, '/home/datasets/cert-data/set\n');
  await ok(['hf', 'download', '--repo-type', 'dataset', 'cert-data/set', '--to', '/home/ds2']);
  assert.equal((await ok(['cat', '/home/ds2/data.csv'])).stdout, 'a,b\n1,2\n');
  assert.ok((await log()).some((x) => x.path === `/datasets/cert-data/set/resolve/${A}/data.csv`));
  await ok(['hf', 'download', 'cert/tiny', 'config.json', '--to', '/home/default-endpoint'], {});
  assert.ok((await log()).every((x) => x.host === 'huggingface.co' || x.host === 'cdn.test'), 'default endpoint is not huggingface.co');

  // Errors: a file not in the repo, a repo not on the Hub.
  const missing = await go(['hf', 'download', 'cert/tiny', 'nope.bin']);
  assert.equal(missing.status, 1, out(missing));
  assert.match(missing.stderr, /nope\.bin is not in cert\/tiny@main/);
  const unknown = await go(['hf', 'download', 'cert/absent']);
  assert.equal(unknown.status, 1, out(unknown));
  assert.match(unknown.stderr, /404 for https:\/\/hub\.test\/api\/models\/cert\/absent\/revision\/main: Repository not found/);

  // Tokens: login/whoami/logout, HF_TOKEN first, gated downloads.
  const TOKEN = '/home/.cache/huggingface/token';
  const nobody = await go(['hf', 'auth', 'whoami']);
  assert.equal(nobody.status, 1, out(nobody));
  assert.match(nobody.stderr, /not logged in/);
  const gatedNo = await go(['hf', 'download', 'cert/gated']);
  assert.equal(gatedNo.status, 1, out(gatedNo));
  assert.match(gatedNo.stderr, /401 .*restricted.*hf auth login/);
  const badLogin = await go(['hf', 'auth', 'login', '--token', 'hf_bad']);
  assert.equal(badLogin.status, 1, out(badLogin));
  assert.match(badLogin.stderr, /invalid token/);
  assert.equal((await go(['test', '-e', TOKEN])).status, 1, 'a rejected token was saved');
  const login = await ok(['hf', 'auth', 'login', '--token', 'hf_good']);
  assert.match(login.stderr, /logged in as cert-user/);
  assert.equal((await ok(['cat', TOKEN])).stdout, 'hf_good\n');
  assert.equal((await ok(['hf', 'auth', 'whoami'])).stdout, 'cert-user\norgs: cert-org\n');
  const envWins = await go(['hf', 'auth', 'whoami'], { ...HUB, HF_TOKEN: 'hf_bad' });
  assert.equal(envWins.status, 1, `HF_TOKEN should take precedence: ${out(envWins)}`);
  await log();
  await ok(['hf', 'download', 'cert/gated']);
  assert.equal(await sums('/home/models/cert/gated', ['secret.bin']), sumLine('/home/models/cert/gated', 'secret.bin', content(4, 40000)));
  l = await log();
  assert.ok(l.filter((x) => x.host === 'hub.test').every((x) => x.auth === 'Bearer hf_good'), 'Hub requests without the token');
  assert.ok(l.some((x) => x.host === 'cdn.test') && l.filter((x) => x.host === 'cdn.test').every((x) => !x.auth), 'the token reached the CDN');
  await ok(['hf', 'auth', 'login'], { ...HUB, HF_HOME: '/home/hfh' }, 'hf_good\n');
  assert.equal((await ok(['cat', '/home/hfh/token'])).stdout, 'hf_good\n');
  await ok(['hf', 'auth', 'logout']);
  assert.equal((await go(['test', '-e', TOKEN])).status, 1, 'logout left the token');
  const viaEnv = await ok(['hf', 'download', 'cert/gated', '--to', '/home/gated-env'], { ...HUB, HF_TOKEN: 'hf_good' });
  assert.match(viaEnv.stderr, /1 downloaded/);
}
