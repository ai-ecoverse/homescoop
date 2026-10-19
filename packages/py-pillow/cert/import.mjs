import { pyImport } from '../../../scripts/browser-cert/py-import.mjs';

export default async function (ctx) {
  await pyImport(ctx, { pkg: 'py-pillow', module: 'PIL', version: '13.0.0', minExt: 4 });
}
