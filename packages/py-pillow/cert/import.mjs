import { pyImport } from '../../../scripts/browser-cert/py-import.mjs';

export default async function (ctx) {
  await pyImport(ctx, { pkg: 'py-pillow', module: 'PIL', version: '12.3.0', minExt: 4 });
}
