#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function devPin(name, { dir = root } = {}) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const raw = pkg.devDependencies?.[name];
  if (!raw) throw new Error(`package.json has no devDependencies entry ${name}`);
  const alias = /^npm:(@?[^@]+)@(.+)$/.exec(raw);
  const [target, version] = alias ? [alias[1], alias[2]] : [name, raw];
  if (!EXACT.test(version)) throw new Error(`package.json devDependencies ${name} is ${JSON.stringify(raw)}, not an exact version`);
  return `${target}@${version}`;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const name = process.argv[2];
  if (!name) {
    console.error('usage: dev-pin.mjs <devDependency>');
    process.exit(2);
  }
  try {
    const spec = devPin(name);
    console.log(spec);
    console.error(`dev-pin: PASS ${spec}`);
  } catch (err) {
    console.error(`dev-pin: FAIL ${err.message}`);
    process.exit(1);
  }
}
