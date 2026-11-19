const PATCHED = [
  'astral-reqwest-middleware 0.5.1',
  'astral-reqwest-retry 0.9.1',
  'cargo-util 0.2.32',
  'hyper-util 0.1.21',
  'reqsign-core 3.3.2',
  'reqsign-google 3.2.0',
  'reqsign-http-send-reqwest 4.0.7',
  'rustls-native-certs 0.8.4',
];

const ASTRAL_CODEC = ['archive-trait 0.0.16', 'tar-codec 0.0.16', 'tar-framing 0.0.16'];
const ASTRAL_CODEC_LICENCE = 'https://raw.githubusercontent.com/astral-sh/astral-codec/072c722cbe4632ac4e938fa53bf15ce27ad4d5df/LICENSE-MIT';

export default async function ({ read, assert, npmName }) {
  const text = await read(`/node_modules/${npmName}/THIRD-PARTY-NOTICES.md`);
  assert.ok(text, 'THIRD-PARTY-NOTICES.md is installed with the package');
  assert.match(text, /^## Rust 1\.99\.0 standard library \(MIT OR Apache-2\.0\)$/m);
  for (const crate of PATCHED) {
    const [name, version] = crate.split(' ');
    assert.match(
      text,
      new RegExp(`^## ${name} ${version.replace(/\./g, '\\.')} \\(`, 'm'),
      `THIRD-PARTY-NOTICES.md must name the patched homescoop-crates crate ${crate} (homescoop#2035)`,
    );
  }
  for (const crate of ASTRAL_CODEC) {
    const [name, version] = crate.split(' ');
    const at = text.search(new RegExp(`^## ${name} ${version.replace(/\./g, '\\.')} \\(MIT OR Apache-2\\.0\\)$`, 'm'));
    assert.ok(at >= 0, `THIRD-PARTY-NOTICES.md must name ${crate}, which uv 0.13.8 links`);
    const end = text.indexOf('\n## ', at + 1);
    const section = text.slice(at, end < 0 ? undefined : end);
    assert.ok(section.includes(ASTRAL_CODEC_LICENCE), `${crate} ships no licence file: its section carries astral-codec's LICENSE-MIT at 072c722c, pinned in scripts/crate-licences.json`);
    assert.match(section, /Permission is hereby granted, free of charge/, `${crate}'s section has the MIT text`);
  }
}
