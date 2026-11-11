// Shared by the gcloud-cli cert specs: where the package is, and a run that
// fails the spec with the command's output when it exits otherwise.
export const PKG = '/node_modules/@ai-ecoverse/gcloud-cli';
export const SDK = `${PKG}/lib/google-cloud-sdk`;

export async function sh(ctx, script, opts = {}) {
  return ctx.run(['bash', '-c', script], { cwd: '/home', ...opts });
}

export async function ok(ctx, script, opts = {}) {
  const r = await sh(ctx, script, opts);
  ctx.assert.equal(r.status, 0, `${script}: rc=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
  return r;
}

export async function readJson(ctx, path) {
  return JSON.parse((await ok(ctx, `cat '${path}'`)).stdout);
}
