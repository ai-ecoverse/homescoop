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
 *   - the license named, in that heading or on a `License: ...` line of the
 *     section: an SPDX id of the declared expression (one of an `OR`, each
 *     of an `AND`; `WITH` exceptions aside), and
 *   - in that section, the license text itself: a phrase from it (`text`, or
 *     the built-in phrase for each SPDX id in LICENSE_PHRASES; for
 *     `A OR B` one of them, for `A AND B` each of them).
 *
 * homescoop_notice (scripts/build-common.sh) writes this shape:
 * "## FreeType 2.13.3 (FreeType License, FTL)" names "FreeType" and FTL, and
 * the fenced license files follow. Add a checklist line in cert/meta.json for cert/notices.mjs.
 * checkNotices() is the pure check (scripts/test/notices.test.mjs).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NOTICES_FILE = 'THIRD-PARTY-NOTICES.md';

/**
 * A verbatim phrase from the body of each license's text
 * (whitespace-normalised, case-insensitive), not its name: a one-line
 * "Licensed under the Apache License" reference must not pass.
 */
export const LICENSE_PHRASES = {
  'Apache-2.0': 'TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION',
  'BSD-2-Clause': 'Redistribution and use in source and binary forms',
  'BSD-3-Clause': 'Neither the name of',
  'BSL-1.0': 'to any person or organization obtaining a copy of the software',
  FTL: 'The FreeType Project is distributed in several archive packages',
  'GPL-2.0-only': 'Everyone is permitted to copy and distribute verbatim copies',
  'GPL-2.0-or-later': 'Everyone is permitted to copy and distribute verbatim copies',
  IJG: 'for any purpose, without fee, subject to these conditions',
  ISC: 'Permission to use, copy, modify, and/or distribute this software for any',
  MIT: 'Permission is hereby granted, free of charge',
  'MIT-CMU': 'Permission to use, copy, modify, and distribute this software and its',
  'MPL-2.0': '"Contributor" means each individual or legal entity',
  'PSF-2.0': 'This LICENSE AGREEMENT is between the Python Software Foundation',
  Qhull: 'A copy of this text file must be distributed along with any copies',
  Zlib: "This software is provided 'as-is', without any express or implied",
};

const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Parse an SPDX expression: { or: [...] } | { and: [...] } | { id }.
 * AND binds tighter than OR, parentheses group, `WITH <exception>` is
 * dropped (the exception does not change which text ships). Throws on a
 * malformed expression.
 */
export function parseLicense(expr) {
  const toks = String(expr).match(/\(|\)|[^\s()]+/g) || [];
  let i = 0;
  const fail = (why) => {
    throw new Error(`bad SPDX expression "${expr}": ${why}`);
  };
  const atom = () => {
    const t = toks[i++];
    if (t === undefined) fail('ends early');
    if (t === '(') {
      const e = or();
      if (toks[i++] !== ')') fail('unbalanced (');
      return e;
    }
    if (t === ')' || t === 'AND' || t === 'OR' || t === 'WITH') fail(`unexpected ${t}`);
    if (toks[i] === 'WITH') {
      i++;
      if (!toks[i] || /^(\(|\)|AND|OR|WITH)$/.test(toks[i])) fail('WITH needs an exception');
      i++;
    }
    return { id: t };
  };
  const and = () => {
    const xs = [atom()];
    while (toks[i] === 'AND') (i++, xs.push(atom()));
    return xs.length === 1 ? xs[0] : { and: xs };
  };
  const or = () => {
    const xs = [and()];
    while (toks[i] === 'OR') (i++, xs.push(and()));
    return xs.length === 1 ? xs[0] : { or: xs };
  };
  const e = or();
  if (i !== toks.length) fail(`unexpected ${toks[i]}`);
  return e;
}

/** Does `pred(id)` satisfy the expression tree (one alternative of an OR, each part of an AND)? */
export function satisfies(node, pred) {
  if (node.or) return node.or.some((n) => satisfies(n, pred));
  if (node.and) return node.and.every((n) => satisfies(n, pred));
  return pred(node.id);
}

/** The SPDX ids of an expression tree, in order. */
export function licenseIds(node) {
  if (node.or) return node.or.flatMap(licenseIds);
  if (node.and) return node.and.flatMap(licenseIds);
  return [node.id];
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
    let tree;
    try {
      tree = parseLicense(c.license);
    } catch (err) {
      return errors.push(`${at}: ${err.message}`);
    }
    if (c.text === undefined && !satisfies(tree, (id) => LICENSE_PHRASES[id])) {
      errors.push(`${at} (${c.name}): no built-in phrase for ${c.license}; give "text"`);
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
    // The license is named in the heading ("## FreeType 2.13.3 (FreeType
    // License, FTL)", homescoop_notice's style) or on a "License:" line.
    const where = [...sec.map((s) => s.heading), ...[...body.matchAll(/^License:\s*(.+?)\s*$/gm)].map((m) => m[1])].join('\n');
    const tree = parseLicense(c.license);
    if (!satisfies(tree, (id) => new RegExp(`(^|[^\\w.+-])${esc(id)}($|[^\\w.+-])`).test(where))) {
      errors.push(`${c.name}: neither its heading nor a "License:" line names ${c.license}`);
    }
    const text = norm(body);
    if (c.text !== undefined) {
      if (!text.includes(norm(c.text))) errors.push(`${c.name}: its section lacks the license text (no "${c.text}")`);
    } else {
      const has = (id) => Boolean(LICENSE_PHRASES[id]) && text.includes(norm(LICENSE_PHRASES[id]));
      if (!satisfies(tree, has)) {
        const missing = [...new Set(licenseIds(tree))].filter((id) => !has(id)).map((id) => (LICENSE_PHRASES[id] ? `${id} "${LICENSE_PHRASES[id]}"` : `${id} (no built-in phrase)`));
        errors.push(`${c.name}: its section lacks the ${c.license} text (not found: ${missing.join(', ')})`);
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
