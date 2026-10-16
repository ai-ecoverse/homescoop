import { pyImport } from '../../../scripts/browser-cert/py-import.mjs';

export default async function (ctx) {
  await pyImport(ctx, { pkg: 'py-python-dateutil', module: 'dateutil', version: '2.9.0.post0' });
}
