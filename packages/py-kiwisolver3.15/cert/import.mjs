import { pyImport } from '../../../scripts/browser-cert/py-import.mjs';

export default async function (ctx) {
  await pyImport(ctx, { pkg: 'py-kiwisolver', module: 'kiwisolver', version: '1.5.1', minExt: 1 });
}
