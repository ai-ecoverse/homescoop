export const GLUE_USER = 'certglue';

export function glueTargets(manifest) {
  const seen = new Map();
  for (const [name, command] of Object.entries(manifest?.slicc?.commands ?? {})) {
    const glue = command?.glue;
    if (typeof glue !== 'string' || !glue) continue;
    const rel = glue.replace(/^\$\{package\}\//, '').replace(/^\.\//, '');
    if (!seen.has(rel)) seen.set(rel, name);
  }
  return [...seen].map(([glue, command]) => ({ glue, command })).sort((a, b) => (a.glue < b.glue ? -1 : 1));
}

const atLeast = (version, [major, minor]) => {
  const m = /^(\d+)\.(\d+)/.exec(version || '');
  return Boolean(m) && (Number(m[1]) > major || (Number(m[1]) === major && Number(m[2]) >= minor));
};

export function glueCheckPlan({ soft, live, modes, users, kernelVersion, meta, manifest }) {
  const targets = glueTargets(manifest);
  const skip = (why) => ({ run: false, why, targets });
  if (live) return skip('--live');
  if (soft) return skip('--soft (kernel-compat runs published packages, some still ship 0644 glue)');
  if (meta?.glueByPath === false) return skip('cert/meta.json glueByPath: false');
  if (!targets.length) return skip('no slicc.commands glue');
  if (modes !== 'tarball') return skip('the kernel keeps its default modes (no kernel.chmod before slicc-kernel 1.86.0)');
  const enforce = users === 'enforce' || (!users && atLeast(kernelVersion, [1, 74]));
  if (!enforce) return skip(`users ${users || 'kernel default'} is not enforce`);
  return { run: true, why: null, targets };
}

export async function glueByPath(ctx, { installDir, targets, log = console.log }) {
  const started = Date.now();
  const cases = { pass: [], fail: [] };
  try {
    await ctx.addUser({ name: GLUE_USER });
  } catch (err) {
    if (!/exist/i.test(String(err?.message || err))) throw err;
  }
  for (const { glue, command } of targets) {
    const path = `/${installDir}${glue}`;
    const id = `glue-by-path:${glue}`;
    let r;
    try {
      r = await ctx.run([path, '--version'], { cwd: '/tmp', user: GLUE_USER, stdin: '' });
    } catch (err) {
      const why = String(err?.message || err).replace(/^(Error: )+/, '').split('\n')[0];
      log(`browser-cert: glue by path as ${GLUE_USER}: ${path} --version: ${why}`);
      if (/EACCES|EPERM|permission denied/i.test(why)) cases.fail.push({ id, message: `${glue} (command ${command}) run by path as ${GLUE_USER}: ${why}` });
      else cases.pass.push(id);
      continue;
    }
    if (r.status === 126) {
      cases.fail.push({ id, message: `${glue} (command ${command}) run by path as ${GLUE_USER}: rc 126, ${(r.stderr || r.stdout).trim().split('\n')[0]}` });
    } else cases.pass.push(id);
    log(`browser-cert: glue by path as ${GLUE_USER}: ${path} --version rc ${r.status}`);
  }
  const failed = cases.fail.length > 0;
  return {
    spec: 'glue-by-path',
    status: failed ? 'fail' : 'pass',
    durationMs: Date.now() - started,
    cases,
    ...(failed ? { error: cases.fail.map((c) => c.message).join('\n') } : {}),
  };
}
