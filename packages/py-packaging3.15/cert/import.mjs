import { pyImport } from '../../../scripts/browser-cert/py-import.mjs';

export default async function (ctx) {
  await pyImport(ctx, { pkg: 'py-packaging', module: 'packaging', version: '26.3', minExt: 0 });
}
