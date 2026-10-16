import { pyImport } from '../../../scripts/browser-cert/py-import.mjs';

export default async function (ctx) {
  await pyImport(ctx, { pkg: 'py-contourpy', module: 'contourpy', version: '1.4.0', minExt: 1 });
}
