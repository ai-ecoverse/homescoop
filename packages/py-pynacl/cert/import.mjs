import { pyImport } from '../../../scripts/browser-cert/py-import.mjs';

export default async function (ctx) {
  await pyImport(ctx, { pkg: 'py-pynacl', module: 'nacl', version: '1.6.2', minExt: 1, dist: 'pynacl' });
}
