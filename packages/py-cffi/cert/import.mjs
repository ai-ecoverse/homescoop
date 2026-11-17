import { pyImport } from '../../../scripts/browser-cert/py-import.mjs';

export default async function (ctx) {
  const { assert } = ctx;
  // cffi's Python package, with its dist-info (PyNaCl's METADATA requires cffi>=2.0.0).
  await pyImport(ctx, { pkg: 'py-cffi', module: 'cffi', version: '2.1.1', dist: 'cffi' });
  // _cffi_backend sits at the top of site-packages, as in cffi's wheels:
  // compiled cffi modules (PyNaCl's _sodium, cryptography's) import it by that name.
  const be = await pyImport(ctx, { pkg: 'py-cffi', module: '_cffi_backend', version: '2.1.1' });
  assert.ok(be.file.endsWith('/lib/python3.15/site-packages/_cffi_backend.cpython-315-wasm32-wasix.so'), JSON.stringify(be));
}
