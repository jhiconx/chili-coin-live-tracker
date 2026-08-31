import { buildLivePayload } from './live.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const requestUrl = new URL(req.url || '/', 'https://chili-coin.local');
  const force = requestUrl.searchParams.get('force') === '1';
  res.setHeader('Cache-Control', force ? 'no-store, max-age=0' : 's-maxage=15, stale-while-revalidate=45');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const payload = await buildLivePayload({ force });
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
