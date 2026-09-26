#!/usr/bin/env jsh
// ladder-run.jsh <package> — install recipe deps, run build.jsh, npm pack.
// Expected to run inside SLICC with HOMESCOOP_ROOT mounted (default /mnt/homescoop).
//
// Dep specs (from recipe dependencies.* or HOMESCOOP_DEPS):
//   zlib / zlib=1.3.1     → ipk mamba install  (emscripten-forge → /shared/lib/conda)
//   @scope/pkg / pkg@1.0  → ipk add -g         (npm → /shared/lib/node_modules)
const { spawn } = require('child_process');

const ROOT = process.env.HOMESCOOP_ROOT || '/mnt/homescoop';
const name = process.argv[2];
if (!name) {
  console.error('usage: ladder-run.jsh <package>');
  process.exit(2);
}

const PKG = `${ROOT}/packages/${name}`;
const OUT = process.env.HOMESCOOP_OUT || '/tmp/homescoop/out';
/** Forge/conda prefix used by `ipk mamba` (also the default link PREFIX). */
const CONDA_PREFIX = process.env.PREFIX || '/shared/lib/conda';

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

/** npm specs use @version or @scope/; conda/mamba specs use name or name=version. */
function isNpmSpec(spec) {
  if (spec.startsWith('@')) return true;
  // bare-name@version (npm), but not name=version (conda)
  return /@[0-9]/.test(spec) || /@latest$/.test(spec) || /@\^/.test(spec);
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

  const mamba = [];
  const npm = [];
  for (const spec of deps) {
    if (isNpmSpec(spec)) npm.push(spec);
    else mamba.push(spec);
  }

  if (mamba.length > 0) {
    console.log(`== ladder-run: ipk mamba install ${mamba.join(' ')}`);
    await sh('ipk', ['mamba', 'install', ...mamba]);
  }
  for (const spec of npm) {
    console.log(`== ladder-run: ipk add -g ${spec}`);
    await sh('ipk', ['add', '-g', spec]);
    // Stage headers/libs into PREFIX for emconfigure (package ships lib/ + include/).
    const bare = spec.replace(/@[^@\/]+$/, '').replace(/^@/, '');
    // @ai-ecoverse/wasm-zlib@1.3.1-2 → @ai-ecoverse/wasm-zlib
    const m = spec.match(/^(@?[^@]+)/);
    const pkgName = m ? m[1] : spec;
    const nm = `/shared/lib/node_modules/${pkgName}`;
    console.log(`== ladder-run: stage ${nm} → ${CONDA_PREFIX}`);
    await sh('sh', [
      '-c',
      `mkdir -p "${CONDA_PREFIX}/lib" "${CONDA_PREFIX}/include" && ` +
        `if [ -d "${nm}/lib" ]; then cp -R "${nm}/lib/." "${CONDA_PREFIX}/lib/"; fi && ` +
        `if [ -d "${nm}/include" ]; then cp -R "${nm}/include/." "${CONDA_PREFIX}/include/"; fi`,
    ]);
  }

  console.log(`== ladder-run: build.jsh (${name})`);
  await sh('jsh', [`${PKG}/build.jsh`], {
    env: {
      HOMESCOOP_ROOT: ROOT,
      PREFIX: CONDA_PREFIX,
    },
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
