import { pyImport } from '../../../scripts/browser-cert/py-import.mjs';

export default async function (ctx) {
  await pyImport(ctx, { pkg: 'py-numpy', module: 'numpy', version: '2.3.2', minExt: 19 });
}
