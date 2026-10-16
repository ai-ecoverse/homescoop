/**
 * Third-party notices check (homescoop#726, #729, #743, #797).
 *
 * A package that bundles or statically links third-party code declares the
 * components in its cert/meta.json:
 *
 *   "notices": [
 *     { "name": "OpenBLAS", "license": "BSD-3-Clause" },
 *     { "name": "FreeType", "license": "FTL OR GPL-2.0-only" },
 *     { "name": "BaKoMa fonts", "license": "LicenseRef-BaKoMa",
 *       "text": "BaKoMa Fonts Licence" }
 *   ]
 *
 * and its cert gets a one-line spec (the template, e.g. cert/notices.mjs):
 *
 *   import { noticesSpec } from '../../../scripts/browser-cert/notices.mjs';
 *   export default noticesSpec(import.meta.url);
 *
 * The spec reads the installed package's THIRD-PARTY-NOTICES.md and fails
 * unless, for every declared component, the file has
 *
 *   - a `## ` heading that names it (case-insensitive, whole words),
 *   - in that section, a line `License: <expr>` with exactly the declared
 *     SPDX expression, and
 *   - in that section, the license text itself: a phrase from it (`text`, or
 *     the built-in phrase for each SPDX id in LICENSE_PHRASES; for
 *     `A OR B` one of them, for `A AND B` each of them).
 *
 * A component's name is what the heading says: "## OpenBLAS 0.3.28" names
 * "OpenBLAS". Add a checklist line in cert/meta.json for cert/notices.mjs.
 * checkNotices() is the pure check (scripts/test/notices.test.mjs).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NOTICES_FILE = 'THIRD-PARTY-NOTICES.md';

/** A verbatim phrase of each license's text (whitespace-normalised, case-insensitive). */
export const LICENSE_PHRASES = {
  'Apache-2.0': 'Apache License',
  'BSD-2-Clause': 'Redistribution and use in source and binary forms',
  'BSD-3-Clause': 'Neither the name of',
  'BSL-1.0': 'Boost Software License',
  FTL: 'The FreeType Project LICENSE',
  'GPL-2.0-only': 'GNU GENERAL PUBLIC LICENSE',
  'GPL-2.0-or-later': 'GNU GENERAL PUBLIC LICENSE',
  IJG: 'Independent JPEG Group',
  ISC: 'Permission to use, copy, modify, and/or distribute this software for any',
  MIT: 'Permission is hereby granted, free of charge',
  'MIT-CMU': 'Permission to use, copy, modify, and distribute this software and its',
  'MPL-2.0': 'Mozilla Public License',
  'PSF-2.0': 'PYTHON SOFTWARE FOUNDATION LICENSE',
  Qhull: 'Geometry Center',
  Zlib: "This software is provided 'as-is', without any express or implied",
};

const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** SPDX ids of an expression, grouped: [[ids of conjunct 1], ...]; `WITH x` drops the exception. */
export function licenseGroups(expr) {
  return String(expr)
    .replace(/[()]/g, ' ')
    .split(/\s+AND\s+/)
    .map((part) =>
      part
        .split(/\s+OR\s+/)
        .map((id) => id.replace(/\s+WITH\s+\S+/, '').trim())
        .filter(Boolean),
    );
}

/**
 * Errors in a cert/meta.json `notices` list (empty when it is usable).
 * @param {unknown} notices
 */
export function noticesMetaErrors(notices) {
  if (!Array.isArray(notices) || notices.length === 0) return ['"notices" must be a non-empty array of { name, license, text? }'];
  const errors = [];
  const names = new Set();
  notices.forEach((c, i) => {
    const at = `notices[${i}]`;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return errors.push(`${at} is not an object`);
    for (const k of Object.keys(c)) if (!['name', 'license', 'text'].includes(k)) errors.push(`${at}: unknown key "${k}"`);
    if (typeof c.name !== 'string' || !c.name.trim()) errors.push(`${at}: "name" must be a non-empty string`);
    else if (names.has(norm(c.name))) errors.push(`${at}: "${c.name}" is declared twice`);
    else names.add(norm(c.name));
    if (typeof c.license !== 'string' || !c.license.trim()) return errors.push(`${at}: "license" must be an SPDX expression`);
    if (c.text !== undefined && (typeof c.text !== 'string' || c.text.trim().length < 8)) errors.push(`${at}: "text" must be a phrase of the license text (8+ characters)`);
    if (c.text === undefined) {
      for (const group of licenseGroups(c.license)) {
        if (!group.some((id) => LICENSE_PHRASES[id])) errors.push(`${at} (${c.name}): no built-in phrase for ${group.join(' OR ')}; give "text"`);
      }
    }
  });
  return errors;
}

/** `## ` sections of a markdown file: [{ heading, body }]. */
export function sections(md) {
  const out = [];
  let cur = null;
  for (const line of String(md).split('\n')) {
    const m = /^##\s+(.*?)\s*#*\s*$/.exec(line);
    if (m && !line.startsWith('###')) {
      cur = { heading: m[1], body: '' };
      out.push(cur);
    } else if (cur) cur.body += `${line}\n`;
  }
  return out;
}

/**
 * What a THIRD-PARTY-NOTICES.md is missing for the declared components.
 * @param {string | null | undefined} md the file's text (null: not shipped)
 * @param {{ name: string, license: string, text?: string }[]} components
 * @returns {string[]} one error per missing piece; empty when complete
 */
export function checkNotices(md, components) {
  const meta = noticesMetaErrors(components);
  if (meta.length) return meta.map((e) => `cert/meta.json: ${e}`);
  if (md == null || md === '') return [`${NOTICES_FILE} is not shipped`];
  const secs = sections(md);
  const errors = [];
  for (const c of components) {
    const named = new RegExp(`(^|[^\\p{L}\\p{N}])${esc(c.name.trim())}($|[^\\p{L}\\p{N}])`, 'iu');
    const sec = secs.filter((s) => named.test(s.heading));
    if (!sec.length) {
      errors.push(`${c.name}: no "## " heading names it`);
      continue;
    }
    const body = sec.map((s) => s.body).join('\n');
    const lic = [...body.matchAll(/^License:\s*(.+?)\s*$/gm)].map((m) => m[1]);
    if (!lic.includes(c.license)) errors.push(`${c.name}: no "License: ${c.license}" line in its section${lic.length ? ` (it says ${lic.map((l) => `"${l}"`).join(', ')})` : ''}`);
    const text = norm(body);
    if (c.text !== undefined) {
      if (!text.includes(norm(c.text))) errors.push(`${c.name}: its section lacks the license text (no "${c.text}")`);
    } else {
      for (const group of licenseGroups(c.license)) {
        const phrases = group.map((id) => LICENSE_PHRASES[id]).filter(Boolean);
        if (!phrases.some((p) => text.includes(norm(p)))) errors.push(`${c.name}: its section lacks the ${group.join(' or ')} text (no ${phrases.map((p) => `"${p}"`).join(' or ')})`);
      }
    }
  }
  return errors;
}

/** The `notices` list of the cert/meta.json beside `specUrl`. */
export function declaredNotices(specUrl) {
  const file = join(dirname(fileURLToPath(specUrl)), 'meta.json');
  let meta;
  try {
    meta = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`notices: cannot read ${file}: ${err.message.split('\n')[0]}`);
  }
  return meta.notices;
}

/**
 * The cert spec: `export default noticesSpec(import.meta.url)`.
 * One assertion per component, so a soft run lists every gap.
 * @param {string} specUrl import.meta.url of the package's cert spec
 */
export function noticesSpec(specUrl) {
  return async function notices(ctx) {
    const { assert } = ctx;
    const components = declaredNotices(specUrl);
    const meta = noticesMetaErrors(components);
    assert.deepEqual(meta, [], `cert/meta.json "notices": ${meta.join('; ')}`);
    const path = `/node_modules/${ctx.npmName}/${NOTICES_FILE}`;
    const md = await ctx.read(path);
    assert.ok(md, `${ctx.npmName} ships ${NOTICES_FILE} (${path} not found)`);
    for (const c of components) {
      const errors = checkNotices(md, [c]);
      assert.deepEqual(errors, [], `${NOTICES_FILE}: ${errors.join('; ')}`);
    }
    console.log(`${ctx.npmName}: ${NOTICES_FILE} names ${components.map((c) => `${c.name} (${c.license})`).join(', ')}`);
  };
}
