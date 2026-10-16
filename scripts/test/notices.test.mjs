import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkNotices, licenseIds, noticesMetaErrors, noticesSpec, parseLicense, satisfies } from '../browser-cert/notices.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const BSD3 = `Copyright (c) 2011-2014, The OpenBLAS Project
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
   3. Neither the name of the OpenBLAS project nor the names of
      its contributors may be used to endorse or promote products`;

const GOOD = `# Third-party notices

py-x statically links the libraries below.

## OpenBLAS 0.3.28

Source: https://github.com/OpenMathLib/OpenBLAS/blob/v0.3.28/LICENSE
License: BSD-3-Clause

${BSD3}

## FreeType 2.14.1

License: FTL OR GPL-2.0-only

Portions of this software are copyright (c) The FreeType Project
(www.freetype.org). All rights reserved.

                    The FreeType Project LICENSE
                    ----------------------------

  The FreeType  Project is distributed in  several archive packages;

## BaKoMa fonts

License: LicenseRef-BaKoMa

   BaKoMa Fonts Licence
   --------------------
`;

const COMPONENTS = [
  { name: 'OpenBLAS', license: 'BSD-3-Clause' },
  { name: 'FreeType', license: 'FTL OR GPL-2.0-only' },
  { name: 'BaKoMa fonts', license: 'LicenseRef-BaKoMa', text: 'BaKoMa Fonts Licence' },
];

test('parseLicense: AND binds tighter than OR, parentheses group, WITH is dropped', () => {
  assert.deepEqual(parseLicense('BSD-3-Clause'), { id: 'BSD-3-Clause' });
  assert.deepEqual(parseLicense('FTL OR GPL-2.0-only'), { or: [{ id: 'FTL' }, { id: 'GPL-2.0-only' }] });
  assert.deepEqual(parseLicense('Apache-2.0 WITH LLVM-exception'), { id: 'Apache-2.0' });
  assert.deepEqual(parseLicense('MIT OR (Apache-2.0 AND BSD-3-Clause)'), { or: [{ id: 'MIT' }, { and: [{ id: 'Apache-2.0' }, { id: 'BSD-3-Clause' }] }] });
  assert.deepEqual(parseLicense('MIT OR Apache-2.0 AND BSD-3-Clause'), parseLicense('MIT OR (Apache-2.0 AND BSD-3-Clause)'));
  assert.deepEqual(licenseIds(parseLicense('(A AND B) OR C')), ['A', 'B', 'C']);
  for (const bad of ['', 'MIT OR', '(MIT', 'MIT)', 'MIT AND AND BSD-3-Clause', 'MIT WITH', 'MIT BSD-3-Clause']) assert.throws(() => parseLicense(bad), /bad SPDX expression/, bad);
  const only = (...ids) => (id) => ids.includes(id);
  const t = parseLicense('MIT OR (Apache-2.0 AND BSD-3-Clause)');
  assert.equal(satisfies(t, only('MIT')), true);
  assert.equal(satisfies(t, only('Apache-2.0')), false);
  assert.equal(satisfies(t, only('Apache-2.0', 'BSD-3-Clause')), true);
});

test('checkNotices: a complete file passes', () => {
  assert.deepEqual(checkNotices(GOOD, COMPONENTS), []);
});

test('checkNotices: not shipped', () => {
  assert.deepEqual(checkNotices(null, COMPONENTS), ['THIRD-PARTY-NOTICES.md is not shipped']);
  assert.deepEqual(checkNotices('', COMPONENTS), ['THIRD-PARTY-NOTICES.md is not shipped']);
});

test('checkNotices: a component without a heading fails, even if the text mentions it', () => {
  const md = GOOD.replace('## OpenBLAS 0.3.28', '## BLAS');
  assert.deepEqual(checkNotices(md, COMPONENTS), ['OpenBLAS: no "## " heading names it']);
  // whole words: "## OpenBLASish" does not name OpenBLAS
  assert.equal(checkNotices(GOOD.replace('## OpenBLAS 0.3.28', '## OpenBLASish'), COMPONENTS).length, 1);
});

test('checkNotices: the license is named in the heading or on a License: line of the section', () => {
  const md = GOOD.replace('License: FTL OR GPL-2.0-only', 'License: MIT');
  assert.deepEqual(checkNotices(md, COMPONENTS), ['FreeType: neither its heading nor a "License:" line names FTL OR GPL-2.0-only']);
  // one alternative of an OR is enough
  assert.deepEqual(checkNotices(GOOD.replace('License: FTL OR GPL-2.0-only', 'License: FTL'), COMPONENTS), []);
  // whole ids: GPL-2.0-only is not GPL-2.0-or-later, BSD-3-Clause is not BSD-3-Clause-Clear
  assert.equal(checkNotices(GOOD.replace('License: FTL OR GPL-2.0-only', 'License: GPL-2.0-or-later'), COMPONENTS).length, 1);
  assert.equal(checkNotices(GOOD.replace('License: BSD-3-Clause\n', 'License: BSD-3-Clause-Clear\n'), COMPONENTS).length, 1);
  // a License: line in another section does not count
  const moved = GOOD.replace('License: BSD-3-Clause\n', '').replace('License: LicenseRef-BaKoMa', 'License: LicenseRef-BaKoMa\nLicense: BSD-3-Clause');
  assert.deepEqual(checkNotices(moved, COMPONENTS), ['OpenBLAS: neither its heading nor a "License:" line names BSD-3-Clause']);
});

test('checkNotices: homescoop_notice style (license in the heading, fenced files)', () => {
  const md = `# Third-party notices\n\nIntro.\n\n## libjpeg-turbo 3.1.2 (IJG, BSD-3-Clause, Zlib)\n\n\`\`\`text\n${BSD3}\nsoftware (or portions thereof) for any purpose, without fee, subject to these\nconditions:\n\`\`\`\n\n## FreeType 2.13.3 (FreeType License, FTL)\n\n\`\`\`text\n                    The FreeType Project LICENSE\n  The FreeType  Project is distributed in  several archive packages;\n\`\`\`\n`;
  const c = [
    { name: 'libjpeg-turbo', license: 'IJG AND BSD-3-Clause' },
    { name: 'FreeType', license: 'FTL OR GPL-2.0-only' },
  ];
  assert.deepEqual(checkNotices(md, c), []);
  assert.deepEqual(checkNotices(md, [{ name: 'libjpeg-turbo', license: 'IJG AND MIT' }]), ['libjpeg-turbo: neither its heading nor a "License:" line names IJG AND MIT', 'libjpeg-turbo: its section lacks the IJG AND MIT text (not found: MIT "Permission is hereby granted, free of charge")']);
});

test('checkNotices: naming the license is not enough, the text must be there', () => {
  const md = GOOD.replace(BSD3, 'See the OpenBLAS LICENSE file.');
  assert.deepEqual(checkNotices(md, COMPONENTS), ['OpenBLAS: its section lacks the BSD-3-Clause text (not found: BSD-3-Clause "Neither the name of")']);
  const noFtl = GOOD.replace('The FreeType  Project is distributed in  several archive packages;', 'FreeType licence');
  assert.deepEqual(checkNotices(noFtl, COMPONENTS), ['FreeType: its section lacks the FTL OR GPL-2.0-only text (not found: FTL "The FreeType Project is distributed in several archive packages", GPL-2.0-only "Everyone is permitted to copy and distribute verbatim copies")']);
  const noBakoma = GOOD.replace('BaKoMa Fonts Licence', 'see upstream');
  assert.deepEqual(checkNotices(noBakoma, COMPONENTS), ['BaKoMa fonts: its section lacks the license text (no "BaKoMa Fonts Licence")']);
});

test('checkNotices: a one-line reference to a license is not its text', () => {
  const ref = (license, line) => checkNotices(`## libx 1.0\nLicense: ${license}\n\n${line}\n`, [{ name: 'libx', license }]);
  assert.equal(ref('Apache-2.0', 'Licensed under the Apache License, Version 2.0; see LICENSE.').length, 1);
  assert.equal(ref('GPL-2.0-only', 'Distributed under the terms of the GNU General Public License.').length, 1);
  assert.equal(ref('FTL OR GPL-2.0-only', 'Under The FreeType Project LICENSE or the GNU General Public License.').length, 1);
  assert.equal(ref('MPL-2.0', 'Mozilla Public License 2.0').length, 1);
  assert.equal(ref('BSL-1.0', 'Boost Software License 1.0').length, 1);
  assert.equal(ref('PSF-2.0', 'PYTHON SOFTWARE FOUNDATION LICENSE VERSION 2').length, 1);
  assert.equal(ref('IJG', 'based in part on the work of the Independent JPEG Group').length, 1);
  assert.equal(ref('Qhull', 'Qhull from C.B. Barber and The Geometry Center').length, 1);
});

test('checkNotices: OR of an AND (MIT OR (Apache-2.0 AND BSD-3-Clause))', () => {
  const license = 'MIT OR (Apache-2.0 AND BSD-3-Clause)';
  const mit = 'Permission is hereby granted, free of charge, to any person';
  const c = [{ name: 'libx', license }];
  assert.deepEqual(checkNotices(`## libx (MIT)\n${mit}\n`, c), []);
  assert.deepEqual(checkNotices(`## libx (Apache-2.0, BSD-3-Clause)\nTERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION\n${BSD3}\n`, c), []);
  assert.equal(checkNotices(`## libx (Apache-2.0)\nTERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION\n`, c).length, 2);
  assert.deepEqual(noticesMetaErrors([{ name: 'libx', license }]), []);
  assert.deepEqual(noticesMetaErrors([{ name: 'libx', license: 'LicenseRef-X OR (MIT AND LicenseRef-Y)' }]), ['notices[0] (libx): no built-in phrase for LicenseRef-X OR (MIT AND LicenseRef-Y); give "text"']);
  assert.deepEqual(noticesMetaErrors([{ name: 'libx', license: 'MIT OR (BSD-3-Clause' }]), ['notices[0]: bad SPDX expression "MIT OR (BSD-3-Clause": unbalanced (']);
});

test('checkNotices: AND needs every license text', () => {
  const md = `## libjpeg-turbo\nLicense: IJG AND BSD-3-Clause AND Zlib\n\nfor any purpose, without fee, subject to these conditions\n${BSD3}\n`;
  const c = [{ name: 'libjpeg-turbo', license: 'IJG AND BSD-3-Clause AND Zlib' }];
  assert.deepEqual(checkNotices(md, c), [`libjpeg-turbo: its section lacks the IJG AND BSD-3-Clause AND Zlib text (not found: Zlib "This software is provided 'as-is', without any express or implied")`]);
  assert.deepEqual(checkNotices(`${md}This software is provided 'as-is', without any express or\nimplied warranty.\n`, c), []);
});

test('noticesMetaErrors: the declared list is checked before the file', () => {
  assert.deepEqual(noticesMetaErrors(COMPONENTS), []);
  assert.equal(noticesMetaErrors(undefined).length, 1);
  assert.equal(noticesMetaErrors([]).length, 1);
  assert.deepEqual(noticesMetaErrors([{ name: 'X', license: 'LicenseRef-X' }]), ['notices[0] (X): no built-in phrase for LicenseRef-X; give "text"']);
  assert.deepEqual(noticesMetaErrors([{ name: 'X', license: 'MIT', url: 'u' }]), ['notices[0]: unknown key "url"']);
  assert.deepEqual(noticesMetaErrors([{ name: 'X', license: 'MIT' }, { name: 'x', license: 'MIT' }]), ['notices[1]: "x" is declared twice']);
  assert.deepEqual(checkNotices(GOOD, []), ['cert/meta.json: "notices" must be a non-empty array of { name, license, text? }']);
});

test('noticesSpec: reads meta.json beside the spec and the installed file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'notices-'));
  try {
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ notices: COMPONENTS }));
    const spec = noticesSpec(pathToFileURL(join(dir, 'notices.mjs')).href);
    const reads = [];
    const ctx = (md) => ({ npmName: '@ai-ecoverse/py-x', assert, read: async (p) => (reads.push(p), md) });
    await spec(ctx(GOOD));
    assert.deepEqual(reads, ['/node_modules/@ai-ecoverse/py-x/THIRD-PARTY-NOTICES.md']);
    await assert.rejects(spec(ctx(null)), /ships THIRD-PARTY-NOTICES\.md/);
    await assert.rejects(spec(ctx(GOOD.replace('## FreeType 2.14.1', '## Other'))), /FreeType: no "## " heading names it/);
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({}));
    await assert.rejects(spec(ctx(GOOD)), /"notices" must be a non-empty array/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repo: every cert/meta.json "notices" is valid and has a noticesSpec spec, and back', () => {
  const problems = [];
  for (const pkg of readdirSync(join(root, 'packages')).sort()) {
    const cert = join(root, 'packages', pkg, 'cert');
    if (!existsSync(cert)) continue;
    const metaFile = join(cert, 'meta.json');
    const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {};
    const specs = readdirSync(cert).filter((f) => f.endsWith('.mjs') && /\bnoticesSpec\s*\(/.test(readFileSync(join(cert, f), 'utf8')));
    if ('notices' in meta) {
      for (const e of noticesMetaErrors(meta.notices)) problems.push(`${pkg}/cert/meta.json: ${e}`);
      if (!specs.length) problems.push(`${pkg}: cert/meta.json declares "notices" but no cert/*.mjs calls noticesSpec(import.meta.url)`);
    } else if (specs.length) problems.push(`${pkg}: cert/${specs[0]} calls noticesSpec but cert/meta.json has no "notices"`);
  }
  assert.deepEqual(problems, []);
});
