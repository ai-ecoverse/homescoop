import { noticesSpec } from '../../../scripts/browser-cert/notices.mjs';

const spec = noticesSpec(import.meta.url);

export default async function (ctx) {
  await spec(ctx);
  const { read, assert, npmName } = ctx;
  const licence = await read(`/node_modules/${npmName}/LICENSE`);
  assert.match(licence, /^MIT License\n\nCopyright \(c\) 2018 Johannes Kaufmann\n/);
  assert.match(licence, /Permission is hereby granted, free of charge/);
  const notices = await read(`/node_modules/${npmName}/THIRD-PARTY-NOTICES.md`);
  assert.match(notices, /^html2markdown\.wasm is html-to-markdown 2\.5\.2 \(MIT; see LICENSE\)/m);
  const headings = notices.match(/^## .*$/gm);
  assert.deepEqual(headings, [
    '## Go 1.27.3 runtime and standard library (BSD-3-Clause)',
    '## github.com/JohannesKaufmann/dom v0.3.1 (MIT)',
    '## github.com/agnivade/levenshtein v1.2.1 (MIT)',
    '## github.com/andybalholm/cascadia v1.3.4 (BSD-2-Clause)',
    '## github.com/aymanbagabas/go-osc52/v2 v2.0.1 (MIT)',
    '## github.com/bmatcuk/doublestar/v4 v4.10.0 (MIT)',
    '## github.com/lucasb-eyer/go-colorful v1.4.0 (MIT)',
    '## github.com/mattn/go-isatty v0.0.22 (MIT)',
    '## github.com/muesli/termenv v0.16.0 (MIT)',
    '## github.com/rivo/uniseg v0.4.7 (MIT)',
    '## golang.org/x/net v0.55.0 (BSD-3-Clause)',
  ]);
  console.log('notices: LICENSE is html-to-markdown\'s MIT licence; THIRD-PARTY-NOTICES.md has Go and the ten linked modules with their licence texts');
}
