#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliTagProblem } from './npm-tag.mjs';
import { verdictIn } from './gate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const USAGE = 'usage: npm-publish.mjs <package.tgz> --npm <name> [--tag <npm-tag>] [--certified <sha256>]';
const ALREADY = 'cannot publish over the previously published versions';
const RECHECK_WAITS = [0, 15, 30, 60, 120];
const AUTH_TRIES = 4;

function run(cmd, args, env) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => {
      process.stdout.write(d);
      out += d;
    });
    p.stderr.on('data', (d) => {
      process.stderr.write(d);
      out += d;
    });
    p.on('error', (err) => resolve({ status: 1, out: `${out}${err.message}\n` }));
    p.on('close', (status) => resolve({ status: status ?? 1, out }));
  });
}

export function versionOf(tgz) {
  const r = spawnSync('tar', ['-xOf', tgz, 'package/package.json'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`cannot read package/package.json from ${tgz}`);
  const { version } = JSON.parse(r.stdout);
  if (typeof version !== 'string' || !version) throw new Error(`${tgz} has no version`);
  if (/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`refuse plain version ${version}: publish X.Y.Z-N only`);
  return version;
}

export async function certifiedPublish({ tgz, name, tag, certified, env }) {
  const r = await run(process.execPath, [join(here, 'assert-certified-publish.mjs'), tgz, '--npm', name, '--tag', tag, '--certified', certified], env);
  if (r.status === 0 && verdictIn('certified-publish', r.out) !== 'PASS') return 3;
  return r.status;
}

export async function publish({ tgz, name, tag, certified, env = process.env, sleep = (s) => new Promise((r) => setTimeout(r, s * 1000)) }) {
  const npm = env.HOMESCOOP_NPM || 'npm';
  const version = versionOf(tgz);
  const id = `${name}@${version}`;
  const tagError = cliTagProblem(tag);
  if (tagError) return { code: 2, verdict: `FAIL ${id}: ${tagError}` };
  const gate = await certifiedPublish({ tgz, name, tag, certified, env });
  if (gate === 10) return { code: 0, verdict: `PASS ${id} (already on npm, same contents; nothing to publish)` };
  if (gate !== 0) return { code: gate, verdict: `FAIL ${id}: certified-publish refused it (exit ${gate})` };
  console.log(`publishing ${id} under --tag ${tag}`);
  for (let attempt = 1; ; attempt++) {
    const r = await run(npm, ['publish', tgz, '--access', 'public', '--tag', tag], env);
    if (r.status === 0) return { code: 0, verdict: `PASS ${id} (published)` };
    if (r.out.includes(ALREADY)) {
      console.log(`already on registry: ${id}; success only if npm has these contents (homescoop#971)`);
      let again = 0;
      for (const wait of RECHECK_WAITS) {
        await sleep(wait);
        again = await certifiedPublish({ tgz, name, tag, certified, env });
        if (again !== 0) break;
      }
      if (again === 10) return { code: 0, verdict: `PASS ${id} (already on npm, same contents)` };
      if (again === 0) return { code: 1, verdict: `FAIL ${id}: npm says it is published, but the registry still serves no ${version} to compare; re-run ladder-build` };
      return { code: 1, verdict: `FAIL ${id}: on npm, but not with these contents (certified-publish exit ${again}); these bytes never shipped` };
    }
    if (/ENEEDAUTH|need auth/.test(r.out) && attempt < AUTH_TRIES) {
      console.log(`OIDC not ready (attempt ${attempt}/${AUTH_TRIES}), retry in ${attempt * 15}s`);
      await sleep(attempt * 15);
      continue;
    }
    return { code: r.status || 1, verdict: `FAIL ${id}: npm publish exited ${r.status}` };
  }
}

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? '') : null;
}

async function main(argv) {
  const tgz = argv[0];
  const name = flag(argv, '--npm');
  if (!tgz || tgz.startsWith('-') || !name) {
    console.error(USAGE);
    console.log('publish: FAIL usage');
    return 2;
  }
  try {
    const { code, verdict } = await publish({ tgz, name, tag: flag(argv, '--tag') ?? 'latest', certified: flag(argv, '--certified') ?? '' });
    const detail = verdict.replace(/^(PASS|FAIL) /, '');
    if (code === 0 && verdict.startsWith('PASS ')) {
      console.log(`publish: PASS ${detail}`);
      return 0;
    }
    console.log(`publish: FAIL ${detail}`);
    return code || 1;
  } catch (err) {
    console.log(`publish: FAIL ${name}: ${err.message}`);
    return 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exit(await main(process.argv.slice(2)));
