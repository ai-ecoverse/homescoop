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

// Merges `state` into the responder's awsCertState (PUT http://log.cert.test/state).
export async function setState(ctx, state) {
  const body = Buffer.from(JSON.stringify(state)).toString('base64');
  await ok(ctx, `python3 -S -c 'import base64, urllib.request; urllib.request.urlopen(urllib.request.Request("http://log.cert.test/state", data=base64.b64decode("${body}"), method="PUT"))'`);
}

// The cert's fixtures (cert/fixtures, see fetch.mjs there), read in Node.
export const fixture = (name) => new URL(`../fixtures/${name}`, import.meta.url);

// Runs a list of aws argvs in one python (lib/aws_many.py), from bin/aws's
// own setup; [{ rc, stdout, stderr }] in the same order.
export async function awsMany(ctx, argvs, { env = keyEnv } = {}) {
  const { readFileSync } = await import('node:fs');
  const tag = Math.random().toString(36).slice(2);
  await ctx.write(`/tmp/aws-many-${tag}.py`, readFileSync(new URL('./aws_many.py', import.meta.url)));
  await ctx.write(`/tmp/aws-many-${tag}.json`, JSON.stringify(argvs));
  await ok(ctx, `${env} python3 -S /tmp/aws-many-${tag}.py ${PKG}/bin/aws /tmp/aws-many-${tag}.json /tmp/aws-many-${tag}.out.json </dev/null`);
  return JSON.parse(await ctx.read(`/tmp/aws-many-${tag}.out.json`));
}
