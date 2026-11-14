import { noticesSpec } from '../../../scripts/browser-cert/notices.mjs';

const spec = noticesSpec(import.meta.url);

export default async function (ctx) {
  await spec(ctx);
  const { read, assert, npmName } = ctx;
  const licence = await read(`/node_modules/${npmName}/LICENSE`);
  assert.match(licence, /^The MIT License \(MIT\)\n/);
  assert.match(licence, /Copyright \(c\) 2017-2026 Fabrice Bellard/);
  assert.match(licence, /Permission is hereby granted, free of charge/);
  const notices = await read(`/node_modules/${npmName}/THIRD-PARTY-NOTICES.md`);
  assert.deepEqual(notices.match(/^## .*$/gm), [
    "## Unicode data (QuickJS-NG's libunicode-table.h; Unicode-3.0)",
    '## wasi-libc (wasi-sdk-34; Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT)',
    "## musl libc (wasi-libc's libc-top-half; MIT)",
    "## cloudlibc (wasi-libc's libc-bottom-half; BSD-2-Clause)",
    "## compiler-rt builtins (wasi-sdk-34's libclang_rt.builtins, llvm-project 895aa2c896ada719451be2e3673c83da8ddf1141; Apache-2.0 WITH LLVM-exception)",
  ]);
  assert.match(notices, /UNICODE LICENSE V3/);
  assert.match(notices, /LLVM Exceptions to the Apache 2\.0 License/);
  console.log("notices: LICENSE is QuickJS-NG's MIT licence; THIRD-PARTY-NOTICES.md has the Unicode data, wasi-libc, musl, cloudlibc and compiler-rt");
}
