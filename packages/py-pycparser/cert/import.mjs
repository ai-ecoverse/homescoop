import { pyImport } from '../../../scripts/browser-cert/py-import.mjs';

export default async function (ctx) {
  await pyImport(ctx, { pkg: 'py-pycparser', module: 'pycparser', version: '3.12', dist: 'pycparser' });
}
