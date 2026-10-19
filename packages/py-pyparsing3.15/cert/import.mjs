import { pyImport } from '../../../scripts/browser-cert/py-import.mjs';

export default async function (ctx) {
  await pyImport(ctx, { pkg: 'py-pyparsing', module: 'pyparsing', version: '3.3.3', minExt: 0 });
}
