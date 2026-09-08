import { fetchBaseStandalone } from './live.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const base = await fetchBaseStandalone();
  return res.status(200).json({
    ok: Boolean(base),
    fetchedAt: base?.fetchedAt,
    base,
    baseTxn: {
      baseTotalCount: base?.transferCount,
      baseLoadedRows: base?.transfers?.length || 0,
      rows: base?.transfers || []
    },
    warnings: base?.warnings || []
  });
}
