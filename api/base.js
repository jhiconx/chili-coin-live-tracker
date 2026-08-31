import { buildLivePayload } from './live.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const payload = await buildLivePayload();
  return res.status(200).json({
    ok: Boolean(payload.base),
    mode: payload.dataMode?.mode,
    fetchedAt: payload.fetchedAt,
    base: payload.base,
    baseTxn: {
      baseTotalCount: payload.transactions?.baseTotalCount,
      baseLoadedRows: payload.transactions?.baseLoadedRows,
      rows: payload.base?.transfers || []
    },
    warnings: payload.warnings || []
  });
}
