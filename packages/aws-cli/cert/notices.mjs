import { noticesSpec } from '../../../scripts/browser-cert/notices.mjs';
import { PKG } from './lib/aws.mjs';

const spec = noticesSpec(import.meta.url);

// THIRD-PARTY-NOTICES.md names each dependency beside the CLI in lib/aws-cli
// with its license text (cert/meta.json notices), and LICENSE is AWS's
// notice followed by the Apache License 2.0 it names.
export default async function (ctx) {
  await spec(ctx);
  const { read, assert } = ctx;
  const licence = await read(`${PKG}/LICENSE`);
  assert.match(licence, /^Copyright Amazon\.com, Inc\. or its affiliates\. All Rights Reserved\.\n/);
  assert.match(licence, /Licensed under the Apache License, Version 2\.0/);
  assert.match(licence, /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/);
  assert.match(licence, /END OF TERMS AND CONDITIONS/);
  const notices = await read(`${PKG}/THIRD-PARTY-NOTICES.md`);
  assert.equal(notices.match(/^## /gm).length, 11, notices.match(/^## .*$/gm).join('\n'));
  console.log("notices: THIRD-PARTY-NOTICES.md has the 10 dependencies' licenses; LICENSE is AWS's notice and the Apache License 2.0");
}
