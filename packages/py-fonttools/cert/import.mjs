import { pyImport } from '../../../scripts/browser-cert/py-import.mjs';

export default async function (ctx) {
  await pyImport(ctx, { pkg: 'py-fonttools', module: 'fontTools', version: '4.66.1', minExt: 0 });
}
