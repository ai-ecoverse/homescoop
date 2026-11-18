import { pyImport } from '../../../scripts/browser-cert/py-import.mjs';

export default async function (ctx) {
  await pyImport(ctx, { pkg: 'py-cryptography', module: 'cryptography', version: '50.0.2', minExt: 1, dist: 'cryptography' });
}
