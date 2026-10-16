import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

export function pathLabel(root, file) {
  const rel = relative(root, file);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : file;
}

export function readCertMeta(file, label = file) {
  if (!existsSync(file)) return {};
  let meta;
  try {
    meta = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${label} is not readable JSON: ${err.message.split('\n')[0]}; nothing was certified`);
  }
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    const kind = meta === null ? 'null' : Array.isArray(meta) ? 'an array' : `a ${typeof meta}`;
    throw new Error(`${label} is not a JSON object (it is ${kind}); nothing was certified`);
  }
  return meta;
}

export function certMetaFile(root, pkg, certDir) {
  const own = join(certDir, 'meta.json');
  if (existsSync(own)) return { file: own, fallback: false };
  const recipe = join(root, 'packages', pkg, 'cert', 'meta.json');
  if (existsSync(recipe)) return { file: recipe, fallback: true };
  return { file: null, fallback: false };
}
