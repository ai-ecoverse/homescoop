// Shared by the aws-cli cert specs: where the package is, a run that fails
// the spec with the command's output when it exits otherwise, fake
// credentials, and the request log of the page's responder.
export const PKG = '/node_modules/@ai-ecoverse/aws-cli';
export const LIB = `${PKG}/lib/aws-cli`;
// Static keys from the AWS documentation's examples, so nothing is real.
export const KEYS = {
  AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
  AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  AWS_DEFAULT_REGION: 'us-east-1',
};
export const keyEnv = Object.entries(KEYS).map(([k, v]) => `${k}='${v}'`).join(' ');

export async function sh(ctx, script, opts = {}) {
  return ctx.run(['bash', '-c', script], { cwd: '/home', ...opts });
}

export async function ok(ctx, script, opts = {}) {
  const r = await sh(ctx, script, opts);
  ctx.assert.equal(r.status, 0, `${script}: rc=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
  return r;
}

// The responders below keep every request in globalThis.awsCertLog and
// answer GET http://log.cert.test/ with it (DELETE empties it).
// The spec reads it through the kernel's proxy with wasix-python's urllib.
export async function requests(ctx) {
  const r = await ok(ctx, `python3 -S -c 'import urllib.request; print(urllib.request.urlopen("http://log.cert.test/").read().decode())'`);
  return JSON.parse(r.stdout);
}

export async function clearLog(ctx) {
  await ok(ctx, `python3 -S -c 'import urllib.request; urllib.request.urlopen(urllib.request.Request("http://log.cert.test/", method="DELETE"))'`);
}

export const header = (req, name) => (req.headers.find(([k]) => k.toLowerCase() === name) || [])[1];
