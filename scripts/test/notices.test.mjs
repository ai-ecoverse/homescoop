import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkNotices, licenseGroups, noticesMetaErrors, noticesSpec } from '../browser-cert/notices.mjs';

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

test('licenseGroups: AND conjuncts of OR alternatives, WITH exceptions dropped', () => {
  assert.deepEqual(licenseGroups('BSD-3-Clause'), [['BSD-3-Clause']]);
  assert.deepEqual(licenseGroups('FTL OR GPL-2.0-only'), [['FTL', 'GPL-2.0-only']]);
  assert.deepEqual(licenseGroups('(IJG AND BSD-3-Clause) AND Zlib'), [['IJG'], ['BSD-3-Clause'], ['Zlib']]);
  assert.deepEqual(licenseGroups('Apache-2.0 WITH LLVM-exception'), [['Apache-2.0']]);
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
  assert.deepEqual(checkNotices(md, COMPONENTS), ['FreeType: neither its heading nor a "License:" line names FTL or GPL-2.0-only']);
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
  const md = `# Third-party notices\n\nIntro.\n\n## libjpeg-turbo 3.1.2 (IJG, BSD-3-Clause, Zlib)\n\n\`\`\`text\n${BSD3}\nthe Independent JPEG Group\n\`\`\`\n\n## FreeType 2.13.3 (FreeType License, FTL)\n\n\`\`\`text\n                    The FreeType Project LICENSE\n\`\`\`\n`;
  const c = [
    { name: 'libjpeg-turbo', license: 'IJG AND BSD-3-Clause' },
    { name: 'FreeType', license: 'FTL OR GPL-2.0-only' },
  ];
  assert.deepEqual(checkNotices(md, c), []);
  assert.deepEqual(checkNotices(md, [{ name: 'libjpeg-turbo', license: 'IJG AND MIT' }]), ['libjpeg-turbo: neither its heading nor a "License:" line names MIT', 'libjpeg-turbo: its section lacks the MIT text (no "Permission is hereby granted, free of charge")']);
});

test('checkNotices: naming the license is not enough, the text must be there', () => {
  const md = GOOD.replace(BSD3, 'See the OpenBLAS LICENSE file.');
  assert.deepEqual(checkNotices(md, COMPONENTS), ['OpenBLAS: its section lacks the BSD-3-Clause text (no "Neither the name of")']);
  const noFtl = GOOD.replace('The FreeType Project LICENSE', 'FreeType licence');
  assert.deepEqual(checkNotices(noFtl, COMPONENTS), ['FreeType: its section lacks the FTL or GPL-2.0-only text (no "The FreeType Project LICENSE" or "GNU GENERAL PUBLIC LICENSE")']);
  const noBakoma = GOOD.replace('BaKoMa Fonts Licence', 'see upstream');
  assert.deepEqual(checkNotices(noBakoma, COMPONENTS), ['BaKoMa fonts: its section lacks the license text (no "BaKoMa Fonts Licence")']);
});

test('checkNotices: AND needs every license text', () => {
  const md = `## libjpeg-turbo\nLicense: IJG AND BSD-3-Clause AND Zlib\n\nthe Independent JPEG Group\n${BSD3}\n`;
  const c = [{ name: 'libjpeg-turbo', license: 'IJG AND BSD-3-Clause AND Zlib' }];
  assert.deepEqual(checkNotices(md, c), [`libjpeg-turbo: its section lacks the Zlib text (no "This software is provided 'as-is', without any express or implied")`]);
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
