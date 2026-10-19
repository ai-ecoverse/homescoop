import { pyImport } from '../../../scripts/browser-cert/py-import.mjs';

export default async function (ctx) {
  await pyImport(ctx, { pkg: 'py-pandas', module: 'pandas', version: '3.0.6', minExt: 40 });
}
