import { pyImport } from '../../../scripts/browser-cert/py-import.mjs';

export default async function (ctx) {
  await pyImport(ctx, { pkg: 'py-bcrypt', module: 'bcrypt', version: '5.0.0', minExt: 1, dist: 'bcrypt' });
}
