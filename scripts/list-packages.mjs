#!/usr/bin/env node
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isRecipeRetired } from './recipe-status.mjs';

const root = new URL('../packages', import.meta.url).pathname;
for (const name of readdirSync(root).sort()) {
  if (isRecipeRetired(name)) continue;
  const pkgPath = join(root, name, 'package', 'package.json');
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (pkg.private) continue;
  console.log(`${pkg.name}@${pkg.version}`);
}
