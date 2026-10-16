#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function peerDirs(env = process.env, base = root) {
  return [
    env.HOMESCOOP_CERT_PEERS,
    join(base, '.homescoop-out/peers'),
    env.RUNNER_TEMP && join(env.RUNNER_TEMP, 'artifacts'),
  ].filter(Boolean).map((d) => resolve(d));
}

function manifestOf(tgz) {
  const r = spawnSync('tar', ['-xzOf', tgz, 'package/package.json'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${tgz}: no package/package.json (${r.stderr.trim()})`);
  return JSON.parse(r.stdout);
}

export function peerTarball(recipe, { env = process.env, base = root } = {}) {
  const want = JSON.parse(readFileSync(join(base, 'packages', recipe, 'package/package.json'), 'utf8'));
  const art = new RegExp(`^host-${recipe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-pr\\d+$`);
  for (const dir of peerDirs(env, base)) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((n) => art.test(n)).sort()) {
      const tgz = join(dir, name, 'package.tgz');
      if (!existsSync(tgz)) continue;
      const sumFile = `${tgz}.sha256`;
      if (!existsSync(sumFile)) throw new Error(`${tgz} has no package.tgz.sha256 beside it`);
      const sum = readFileSync(sumFile, 'utf8').split(/\s/)[0];
      const got = createHash('sha256').update(readFileSync(tgz)).digest('hex');
      if (sum !== got) throw new Error(`${tgz} is ${got}, its package.tgz.sha256 says ${sum}`);
      const m = manifestOf(tgz);
      if (m.name !== want.name || m.version !== want.version) {
        throw new Error(`${tgz} is ${m.name}@${m.version}, packages/${recipe} wants ${want.name}@${want.version}`);
      }
      return tgz;
    }
  }
  return `${want.name}@${want.version}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const recipe = process.argv[2];
  if (!recipe) {
    console.error('usage: peer-tarball.mjs <recipe>');
    process.exit(2);
  }
  console.log(peerTarball(recipe));
}
