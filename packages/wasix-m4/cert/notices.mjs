const PKG = '/node_modules/@ai-ecoverse/wasix-m4';

export default async function (ctx) {
  const { read, assert, installed } = ctx;
  const pkg = installed[0];
  const notices = await read(`${PKG}/THIRD-PARTY-NOTICES.md`);
  assert.ok(notices, 'THIRD-PARTY-NOTICES.md ships');
  const libc = notices.match(/^## wasix-libc \(@ai-ecoverse\/wasix-sysroot (2025\.9\.30-\d+); files from tag (v\d{4}-\d{2}-\d{2}\.\d+)\)$/m);
  assert.ok(libc, `THIRD-PARTY-NOTICES.md names the wasix-libc that m4.wasm links: ${notices.slice(0, 300)}`);
  for (const text of ['Apache License v2.0 with LLVM Exceptions', 'Permission is hereby granted, free of charge', 'musl as a whole is licensed under the following standard MIT license', 'Nuxi (https://nuxi.nl/) and contributors']) {
    assert.ok(notices.includes(text), `THIRD-PARTY-NOTICES.md carries ${JSON.stringify(text)}`);
  }
  const sources = await read(`${PKG}/SOURCES.md`);
  assert.ok(sources && /m4-1\.4\.20\.tar\.xz/.test(sources) && /patches\/getlocalename-wasix\.patch/.test(sources), `SOURCES.md names the tarball and the patch: ${sources}`);
  const patch = await read(`${PKG}/patches/getlocalename-wasix.patch`);
  assert.ok(patch && /^(diff |--- )/m.test(patch), 'patches/getlocalename-wasix.patch ships beside SOURCES.md');
  const named = pkg.description.match(/wasix-sysroot (2025\.9\.30-\d+)/)?.[1];
  assert.ok(!named || named === libc[1], `package.json description names wasix-sysroot ${named}, but m4.wasm links ${libc[1]}`);
  console.log(`wasix-m4: THIRD-PARTY-NOTICES.md (wasix-libc of wasix-sysroot ${libc[1]}, tag ${libc[2]}), SOURCES.md and the patch ship; the description names no other sysroot`);
}
