#!/usr/bin/env node
import { chmodSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const KEYS = ['glue', 'wasm', 'script'];

function commandFiles(pkg) {
  const files = new Set();
  for (const command of Object.values(pkg.slicc?.commands ?? {})) {
    for (const key of KEYS) {
      const value = command?.[key];
      if (typeof value === 'string' && value) files.add(value.replace(/^\$\{package\}\//, '').replace(/^\.\//, ''));
    }
  }
  return [...files].sort();
}

function fix(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const changed = [];
  for (const rel of commandFiles(pkg)) {
    const file = join(dir, rel);
    if (!existsSync(file)) {
      console.error(`command-modes: ${rel} is named in slicc.commands but missing from ${dir}`);
      process.exit(1);
    }
    if ((statSync(file).mode & 0o777) !== 0o755) {
      chmodSync(file, 0o755);
      changed.push(rel);
    }
  }
  console.log(`command-modes: ${commandFiles(pkg).length} command file(s) 0755${changed.length ? `; set ${changed.join(', ')}` : ''}`);
}

function entries(tgz) {
  const buf = gunzipSync(readFileSync(tgz));
  const out = new Map();
  for (let at = 0; at + 512 <= buf.length; ) {
    const header = buf.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const str = (from, len) => header.subarray(from, from + len).toString('utf8').replace(/\0.*$/s, '');
    const name = (str(345, 155) ? `${str(345, 155)}/` : '') + str(0, 100);
    const mode = parseInt(str(100, 8).trim() || '0', 8);
    const size = parseInt(str(124, 12).trim() || '0', 8);
    out.set(name, mode & 0o777);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

function check(tgz) {
  const files = entries(tgz);
  const raw = gunzipSync(readFileSync(tgz));
  const pkgName = [...files.keys()].find((n) => n === 'package/package.json');
  if (!pkgName) {
    console.error(`command-modes: ${tgz} has no package/package.json`);
    process.exit(1);
  }
  const text = (() => {
    for (let at = 0; at + 512 <= raw.length; ) {
      const header = raw.subarray(at, at + 512);
      if (header.every((b) => b === 0)) break;
      const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
      const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8);
      if (name === 'package/package.json') return raw.subarray(at + 512, at + 512 + size).toString('utf8');
      at += 512 + Math.ceil(size / 512) * 512;
    }
    return '';
  })();
  const bad = [];
  const wanted = commandFiles(JSON.parse(text));
  for (const rel of wanted) {
    const mode = files.get(`package/${rel}`);
    if (mode === undefined) bad.push(`${rel} missing`);
    else if (mode !== 0o755) bad.push(`${rel} ${mode.toString(8).padStart(4, '0')}`);
  }
  if (bad.length) {
    console.error(`command-modes: ${tgz}: command files not 0755: ${bad.join(', ')}`);
    process.exit(1);
  }
  console.log(`command-modes: ${tgz}: ${wanted.length} command file(s), all 0755`);
}

const [mode, target] = process.argv.slice(2);
if (mode === '--fix' && target) fix(target);
else if (mode === '--check' && target) check(target);
else {
  console.error('usage: command-modes.mjs --fix <package dir> | --check <package.tgz>');
  process.exit(2);
}
