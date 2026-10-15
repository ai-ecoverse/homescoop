#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { devPin } from '../dev-pin.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const KERNEL = '@ai-ecoverse/slicc-kernel';

function metaKernel(pkg, dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'packages', pkg, 'cert', 'meta.json'), 'utf8')).kernel || '';
  } catch {
    return '';
  }
}

export function certKernel(pkg, { dir = root, log = console.error } = {}) {
  const named = metaKernel(pkg, dir);
  if (named) {
    log(`browser-cert: kernel ${named} from packages/${pkg}/cert/meta.json`);
    return named;
  }
  const spec = devPin(KERNEL, { dir });
  log(`browser-cert: kernel ${spec} from package.json devDependencies; packages/${pkg}/cert/meta.json names none`);
  return spec;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const pkg = process.argv[2];
  if (!pkg) {
    console.error('usage: cert-kernel.mjs <package>');
    process.exit(2);
  }
  try {
    console.log(certKernel(pkg));
  } catch (err) {
    console.error(`browser-cert: no cert kernel for ${pkg}: ${err.message}`);
    process.exit(1);
  }
}
