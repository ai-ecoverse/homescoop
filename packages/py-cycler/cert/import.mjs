import { pyImport } from '../../../scripts/browser-cert/py-import.mjs';

export default async function (ctx) {
  await pyImport(ctx, { pkg: 'py-cycler', module: 'cycler', version: '0.12.1', minExt: 0 });
}
