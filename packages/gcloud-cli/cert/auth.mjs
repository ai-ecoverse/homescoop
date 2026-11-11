import { sh } from './lib/gcloud.mjs';

// homescoop#2037: with no browser in the kernel, plain `gcloud auth login`
// takes Google's remote flow (as --no-launch-browser does): it prints an
// accounts.google.com URL whose redirect is https://sdk.cloud.google.com/authcode.html
// (PKCE S256, never 127.0.0.1 or localhost), then asks for the code. With no
// code on stdin it exits 1 and stores nothing.
export default async function (ctx) {
  const { assert } = ctx;
  for (const flags of ['', '--no-launch-browser']) {
    const r = await sh(ctx, `gcloud auth login ${flags} </dev/null`);
    const out = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 1, `gcloud auth login ${flags}: rc=${r.status}\n${out}`);
    const url = out.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/auth\?\S+/)?.[0];
    assert.ok(url, `gcloud auth login ${flags}: no authorize URL\n${out}`);
    const q = new URL(url).searchParams;
    assert.equal(q.get('redirect_uri'), 'https://sdk.cloud.google.com/authcode.html', url);
    assert.equal(q.get('client_id'), '32555940559.apps.googleusercontent.com', url);
    assert.equal(q.get('code_challenge_method'), 'S256', url);
    assert.match(q.get('code_challenge') || '', /^[A-Za-z0-9_-]{43}$/, url);
    for (const s of ['openid', 'https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/compute']) {
      assert.ok(q.get('scope').split(' ').includes(s), `scope ${s} in ${q.get('scope')}`);
    }
    assert.doesNotMatch(out, /127\.0\.0\.1|localhost/, out);
    assert.match(out, /enter the verification code provided in your browser/, out);
  }
  const list = await sh(ctx, 'gcloud auth list --format=json');
  assert.equal(list.status, 0, list.stderr);
  assert.deepEqual(JSON.parse(list.stdout), [], 'no account stored');
  console.log('gcloud auth login (no flag and --no-launch-browser): authorize URL redirects to https://sdk.cloud.google.com/authcode.html with PKCE S256, no loopback; no code, rc 1, no account stored');
}
