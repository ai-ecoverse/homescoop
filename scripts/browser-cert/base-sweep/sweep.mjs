import { readFileSync, writeFileSync } from 'node:fs';

const meta = JSON.parse(readFileSync(new URL('./meta.json', import.meta.url), 'utf8'));
const KERNEL = '@ai-ecoverse/slicc-kernel';

export function commandsOf(manifests, m = meta) {
  const owners = new Map();
  const sorted = [...manifests].filter((p) => p.name !== KERNEL).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const p of sorted) {
    for (const command of Object.keys(p.slicc?.commands || {})) {
      const seen = owners.get(command);
      if (seen) {
        seen.alsoIn.push(p.name);
        continue;
      }
      const inv = m.invocations[command] || {};
      owners.set(command, {
        command,
        package: p.name,
        version: p.version,
        alsoIn: [],
        ...(inv.skip
          ? { skip: inv.skip }
          : {
              argv: inv.sh ? ['bash', '-c', inv.sh] : inv.argv || [command, '--version'],
              rc: inv.rc ?? 0,
              env: inv.env || {},
            }),
      });
    }
  }
  const real = Object.entries(m.real).map(([name, r]) => ({
    command: `real:${name}`,
    package: r.package,
    version: sorted.find((p) => p.name === r.package)?.version ?? null,
    alsoIn: [],
    argv: ['bash', '-c', r.sh],
    rc: 0,
    env: {},
  }));
  return [...owners.values(), ...real];
}

function bounded(ctx, argv, opts, ms) {
  return ctx.page.evaluate(
    async (a, o, limit) => {
      const timer = new Promise((done) => {
        setTimeout(() => done({ status: 'timeout', stdout: '', stderr: `no exit in ${limit} ms` }), limit);
      });
      const ran = window.kernel.run(a, o).catch((e) => ({ status: 'error', stdout: '', stderr: String(e?.message || e) }));
      return Promise.race([ran, timer]);
    },
    argv,
    opts,
    ms,
  );
}

export default async function (ctx) {
  const only = process.env.HOMESCOOP_SWEEP_ONLY ? JSON.parse(process.env.HOMESCOOP_SWEEP_ONLY) : null;
  const rows = commandsOf(ctx.installed).filter((r) => !only || only.includes(r.command));
  await ctx.addUser({ name: 'cone' });
  const homes = { root: '/root', cone: '/home/cone' };
  const out = [];
  for (const user of meta.accounts) {
    for (const row of rows) {
      const base = { user, command: row.command, package: row.package, version: row.version, alsoIn: row.alsoIn };
      if (row.skip) {
        out.push({ ...base, status: 'skip', why: row.skip });
        continue;
      }
      const started = Date.now();
      const r = await bounded(ctx, row.argv, { user, cwd: homes[user], env: row.env, stdin: '' }, meta.commandTimeoutMs);
      const ok = r.status === row.rc;
      const text = `${r.stdout || ''}${r.stderr || ''}`.replace(/\s+/g, ' ').trim().slice(0, 300);
      out.push({ ...base, argv: row.argv, rc: r.status, expected: row.rc, status: ok ? 'pass' : 'fail', out: text, durationMs: Date.now() - started });
      console.log(`SW ${ctx.users || 'default'} ${user} ${row.command} rc=${r.status}${ok ? '' : ` want ${row.rc}: ${text.slice(0, 120)}`}`);
    }
  }
  if (process.env.HOMESCOOP_SWEEP_OUT) {
    writeFileSync(process.env.HOMESCOOP_SWEEP_OUT, `${JSON.stringify({ kernel: ctx.kernel, users: ctx.users, rows: out }, null, 2)}\n`);
  }
  const bad = out.filter((r) => r.status === 'fail');
  ctx.assert.equal(bad.length, 0, `base sweep: ${bad.map((r) => `${r.user} ${r.command} rc=${r.rc}`).join(', ')}`);
}
