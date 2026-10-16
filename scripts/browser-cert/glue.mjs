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

const kernelVersionOf = (spec) => /@(\d+\.\d+\.\d+[^@\s]*)$/.exec(spec || '')?.[1] || '';

/**
 * homescoop#628: ladder-pr runs a package's specs on its cert/meta.json
 * kernel only, so a package whose cert kernel cannot run glue by path (no
 * kernel.chmod before slicc-kernel 1.86.0, or users not enforce) never got
 * the check. Returns null when the main run checks the glue itself, else
 * { why, kernel, users: 'enforce' } for a --glue-only run on `fallbackKernel`
 * (the root package.json's certified dev pin).
 */
export function glueFallback({ meta, manifest, certKernel, fallbackKernel }) {
  const version = kernelVersionOf(certKernel);
  const main = glueCheckPlan({
    soft: false,
    live: false,
    modes: atLeast(version, [1, 86]) ? 'tarball' : 'kernel defaults',
    users: meta?.users || '',
    kernelVersion: version,
    meta,
    manifest,
  });
  if (main.run || !main.targets.length || meta?.glueByPath === false) return null;
  const fallback = kernelVersionOf(fallbackKernel);
  const extra = glueCheckPlan({
    soft: false,
    live: false,
    modes: atLeast(fallback, [1, 86]) ? 'tarball' : 'kernel defaults',
    users: 'enforce',
    kernelVersion: fallback,
    meta,
    manifest,
  });
  if (!extra.run) throw new Error(`glue by path: the fallback kernel ${fallbackKernel} cannot run it either (${extra.why})`);
  return { why: `${certKernel}: ${main.why}`, kernel: fallbackKernel, users: 'enforce' };
}

/**
 * What run.mjs does with a package (homescoop#628's --glue-only included):
 * 'glue-only' (no specs, no smoke), 'specs', 'smoke', or 'skip' (with why).
 */
export function runMode({ glueOnly, specs, abi, commands }) {
  if (glueOnly) return { mode: 'glue-only' };
  if (specs > 0) return { mode: 'specs' };
  if (abi !== 'emscripten') return { mode: 'skip', why: `abi=${abi}; no cert/*.mjs` };
  if (!commands) return { mode: 'skip', why: 'no slicc.commands; lib cert is host-smoke' };
  return { mode: 'smoke' };
}

/**
 * After the specs: 'run' glue by path, 'fail' (--glue-only, but this kernel
 * or users mode cannot run it), or 'skip' (log `why` when there is glue).
 */
export function glueStep({ glueOnly, plan }) {
  if (plan.run) return { action: 'run' };
  if (glueOnly) return { action: 'fail', why: `--glue-only, but glue by path cannot run: ${plan.why}` };
  return { action: 'skip', why: plan.why, log: plan.targets.length > 0 };
}
