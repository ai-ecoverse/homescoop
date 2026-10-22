/**
 * Shared by the wasix-php specs: write a PHP script into the kernel's
 * filesystem and run it with the installed php (cert/lib: not a spec).
 */
let n = 0;
export async function php(ctx, code, opts = {}) {
  const dir = opts.dir || '/tmp/php-cert';
  const file = `${dir}/s${process.pid}-${n++}.php`;
  await ctx.write(file, code);
  return ctx.run(['php', ...(opts.flags || []), file, ...(opts.args || [])], {
    cwd: opts.cwd || '/tmp',
    env: opts.env || {},
    stdin: opts.stdin,
    ...(opts.user !== undefined && { user: opts.user }),
  });
}

/** php() that must exit 0; returns stdout. */
export async function phpOk(ctx, code, opts = {}) {
  const r = await php(ctx, code, opts);
  ctx.assert.equal(r.status, 0, `php rc=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}\n--- script ---\n${code}`);
  return r.stdout;
}
