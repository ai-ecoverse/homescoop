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
}
