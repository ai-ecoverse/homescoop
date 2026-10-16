import { pyImport } from '../../../scripts/browser-cert/py-import.mjs';

export default async function (ctx) {
  await pyImport(ctx, { pkg: 'py-pandas', module: 'pandas', version: '2.3.2', minExt: 44 });
}
