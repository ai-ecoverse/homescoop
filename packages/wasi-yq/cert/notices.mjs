import { noticesSpec } from '../../../scripts/browser-cert/notices.mjs';

const spec = noticesSpec(import.meta.url);

export default async function (ctx) {
  await spec(ctx);
  const { read, assert, npmName } = ctx;
  const licence = await read(`/node_modules/${npmName}/LICENSE`);
  assert.match(licence, /^The MIT License \(MIT\)\n\nCopyright \(c\) 2017 Mike Farah\n/);
  assert.match(licence, /Permission is hereby granted, free of charge/);
  const notices = await read(`/node_modules/${npmName}/THIRD-PARTY-NOTICES.md`);
  assert.match(notices, /^yq\.wasm is yq 4\.54\.1 \(MIT; see LICENSE\)/m);
  const headings = notices.match(/^## .*$/gm);
  assert.deepEqual(headings, [
    '## Go 1.27.3 runtime and standard library (BSD-3-Clause)',
    '## github.com/a8m/envsubst v1.4.3 (MIT)',
    '## github.com/agext/levenshtein v1.2.1 (Apache-2.0)',
    '## github.com/alecthomas/participle/v2 v2.1.4 (MIT)',
    '## github.com/apparentlymart/go-textseg/v17 v17.0.1 (MIT)',
    '## github.com/dimchansky/utfbom v1.1.1 (Apache-2.0)',
    '## github.com/elliotchance/orderedmap v1.8.0 (MIT)',
    '## github.com/fatih/color v1.19.0 (MIT)',
    '## github.com/go-ini/ini v1.67.0 (Apache-2.0)',
    '## github.com/goccy/go-json v0.10.6 (MIT)',
    '## github.com/goccy/go-yaml v1.19.2 (MIT)',
    '## github.com/google/go-cmp v0.6.0 (BSD-3-Clause)',
    '## github.com/hashicorp/hcl/v2 v2.25.0 (MPL-2.0)',
    '## github.com/jinzhu/copier v0.4.0 (MIT)',
    '## github.com/magiconair/properties v1.18.12 (BSD-2-Clause)',
    '## github.com/mattn/go-colorable v0.1.14 (MIT)',
    '## github.com/mattn/go-isatty v0.0.24 (MIT)',
    '## github.com/mitchellh/go-wordwrap v1.0.1 (MIT)',
    '## github.com/pelletier/go-toml/v2 v2.4.3 (MIT)',
    '## github.com/spf13/cobra v1.10.2 (Apache-2.0)',
    '## github.com/spf13/pflag v1.0.10 (BSD-3-Clause)',
    '## github.com/yuin/gopher-lua v1.1.2 (MIT)',
    '## github.com/zclconf/go-cty v1.19.0 (MIT)',
    '## go.yaml.in/yaml/v4 v4.0.0-rc.6 (Apache-2.0 AND MIT)',
    '## golang.org/x/net v0.59.0 (BSD-3-Clause)',
    '## golang.org/x/text v0.42.0 (BSD-3-Clause)',
  ]);
  assert.match(notices, /Mozilla Public License, version 2\.0/);
  assert.match(notices, /ported to Go from C files of libyaml/);
  console.log('notices: LICENSE is yq\'s MIT licence; THIRD-PARTY-NOTICES.md has Go and the 25 linked modules with their licence texts');
}
