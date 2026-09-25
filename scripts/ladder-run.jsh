#!/usr/bin/env jsh
// ladder-run.jsh <package> — install recipe deps, run build.jsh, npm pack.
// Expected to run inside SLICC with HOMESCOOP_ROOT mounted (default /mnt/homescoop).
const { spawn } = require('child_process');

const ROOT = process.env.HOMESCOOP_ROOT || '/mnt/homescoop';
const name = process.argv[2];
if (!name) {
  console.error('usage: ladder-run.jsh <package>');
  process.exit(2);
}

const PKG = `${ROOT}/packages/${name}`;
const OUT = process.env.HOMESCOOP_OUT || '/tmp/homescoop/out';

function sh(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: opts.cwd || process.cwd(),
      env: { ...process.env, ...(opts.env || {}) },
    });
    let out = '';
    child.stdout.on('data', (c) => {
      out += c;
      process.stdout.write(c);
    });
    child.stderr.on('data', (c) => process.stderr.write(c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited ${code}`));
    });
  });
}

async function main() {
  await sh('mkdir', ['-p', OUT]);

  // Refuse to run a host recipe inside the cone by accident.
  try {
    const b = (
      await sh('node', [`${ROOT}/scripts/read-recipe.mjs`, name, '--field', 'builder'])
    ).trim();
    if (b && b !== 'slicc') {
      throw new Error(
        `recipe builder is '${b}' — use scripts/host-run.sh on the runner, not ladder-run.jsh`
      );
    }
  } catch (e) {
    if (String(e).includes('recipe builder')) throw e;
  }

  // Deps: runner can also pass HOMESCOOP_DEPS as newline-separated ipk specs.
  let deps = (process.env.HOMESCOOP_DEPS || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (deps.length === 0) {
    try {
      const raw = await sh('node', [
        `${ROOT}/scripts/read-recipe.mjs`,
        name,
        '--deps',
      ]);
      deps = raw.split('\n').map((s) => s.trim()).filter(Boolean);
    } catch {
      console.log('== ladder-run: no deps (read-recipe unavailable or empty)');
    }
  }

  for (const spec of deps) {
    console.log(`== ladder-run: ipk add -g ${spec}`);
    await sh('ipk', ['add', '-g', spec]);
  }

  console.log(`== ladder-run: build.jsh (${name})`);
  await sh('jsh', [`${PKG}/build.jsh`], {
    env: { HOMESCOOP_ROOT: ROOT },
  });

  console.log(`== ladder-run: npm pack`);
  const packOut = await sh('npm', ['pack', '--pack-destination', OUT], {
    cwd: `${PKG}/package`,
  });
  const tgz = packOut
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  if (!tgz) throw new Error('npm pack produced no tarball name');
  const abs = tgz.startsWith('/') ? tgz : `${OUT}/${tgz}`;
  console.log(`== ladder-run: packed ${abs}`);
  await sh('cp', [abs, `${OUT}/package.tgz`]);
  console.log(`== ladder-run: ${OUT}/package.tgz`);
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
