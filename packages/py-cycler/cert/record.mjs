import { pyRecord } from '../../../scripts/browser-cert/py-record.mjs';

export default async function (ctx) {
  await pyRecord(ctx, { pkg: 'py-cycler' });
}
