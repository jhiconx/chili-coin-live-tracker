const ETH_TOKEN = '0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA';
const BASE_TOKEN = '0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8';
const ETHERSCAN_URL = `https://etherscan.io/token/${ETH_TOKEN}`;
const BASESCAN_URL = `https://basescan.org/token/${BASE_TOKEN}#transactions`;
const TIMEOUT_MS = 12_000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        accept: options.accept || '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        'user-agent': 'Mozilla/5.0 (compatible; ChiliCoinLiveTracker/2.0)',
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function toPlainText(html) {
  return decodeEntities(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseHolderCount(content) {
  const raw = String(content || '');
  const plain = toPlainText(raw);
  const patterns = [
    /\bHolders\b\s*([\d,]+)/i,
    /####\s*Holders\s*([\d,]+)/i,
    /"holders_count"\s*:\s*"?([\d,]+)"?/i,
    /"holdersCount"\s*:\s*"?([\d,]+)"?/i,
    /Holders[\s\S]{0,300}?>([\d,]+)</i
  ];

  for (const source of [plain, raw]) {
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (!match) continue;
      const count = Number(match[1].replace(/,/g, ''));
      if (Number.isInteger(count) && count >= 0) return count;
    }
  }
  return null;
}

async function fetchBaseScanHolderCount() {
  const pageUrl = `https://basescan.org/token/${BASE_TOKEN}`;
  const attempts = [
    { url: pageUrl, source: 'BaseScan' },
    { url: `https://r.jina.ai/https://basescan.org/token/${BASE_TOKEN}`, source: 'BaseScan via text mirror' }
  ];

  const failures = [];
  for (const attempt of attempts) {
    try {
      const response = await fetchWithTimeout(attempt.url, {
        headers: attempt.url.includes('r.jina.ai')
          ? { 'x-no-cache': 'true', 'x-return-format': 'text' }
          : {}
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const content = await response.text();
      const count = parseHolderCount(content);
      if (count === null) throw new Error('holder count was not present in the response');
      return { count, source: attempt.source, sourceUrl: BASESCAN_URL };
    } catch (error) {
      failures.push(`${attempt.source}: ${error.message}`);
    }
  }

  throw new Error(failures.join(' | '));
}

async function fetchTokenInfo(apiRoot, token) {
  const response = await fetchWithTimeout(`${apiRoot}/tokens/${token}`, {
    headers: { accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const count = Number(data.holders_count ?? data.holdersCount ?? data.holder_count);
  return {
    count: Number.isFinite(count) ? count : null,
    name: data.name || null,
    symbol: data.symbol || null,
    type: data.type || null
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestUrl = new URL(req.url || '/', 'https://chili-coin.local');
  const force = requestUrl.searchParams.get('force') === '1';
  res.setHeader('Cache-Control', force ? 'no-store, max-age=0' : 's-maxage=15, stale-while-revalidate=30');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const fetchedAt = new Date().toISOString();
  const [baseScan, ethInfo, baseInfo] = await Promise.allSettled([
    fetchBaseScanHolderCount(),
    fetchTokenInfo('https://eth.blockscout.com/api/v2', ETH_TOKEN),
    fetchTokenInfo('https://base.blockscout.com/api/v2', BASE_TOKEN)
  ]);

  const warnings = [];
  const baseScanValue = baseScan.status === 'fulfilled' ? baseScan.value : null;
  const ethValue = ethInfo.status === 'fulfilled' ? ethInfo.value : null;
  const baseInfoValue = baseInfo.status === 'fulfilled' ? baseInfo.value : null;

  if (!baseScanValue) warnings.push(`BaseScan holder count unavailable: ${baseScan.reason?.message || 'unknown error'}`);
  if (!ethValue) warnings.push(`Ethereum holder count unavailable: ${ethInfo.reason?.message || 'unknown error'}`);
  if (!baseInfoValue) warnings.push(`Base token metadata unavailable: ${baseInfo.reason?.message || 'unknown error'}`);

  let baseHolders = baseScanValue?.count ?? null;
  let baseHolderSource = baseScanValue?.source ?? null;
  let baseHolderSourceUrl = baseScanValue?.sourceUrl ?? BASESCAN_URL;

  if (baseHolders === null && Number.isFinite(baseInfoValue?.count)) {
    baseHolders = baseInfoValue.count;
    baseHolderSource = 'Base Blockscout fallback';
    baseHolderSourceUrl = `https://base.blockscout.com/token/${BASE_TOKEN}`;
    warnings.push('The Base holder headline is using Blockscout because BaseScan could not be read.');
  }

  const ethHolders = Number.isFinite(ethValue?.count) ? ethValue.count : null;
  const chainTotal = Number.isFinite(ethHolders) && Number.isFinite(baseHolders)
    ? ethHolders + baseHolders
    : null;

  return res.status(200).json({
    ok: Boolean(baseHolders !== null || ethHolders !== null),
    fetchedAt,
    refreshSeconds: 20,
    contracts: {
      ethereumToken: ETH_TOKEN,
      baseToken: BASE_TOKEN
    },
    ethereum: {
      holders: ethHolders,
      holderSource: ethValue ? 'Ethereum Blockscout' : null,
      holderSourceUrl: `https://eth.blockscout.com/token/${ETH_TOKEN}`,
      explorerUrl: ETHERSCAN_URL,
      token: ethValue
    },
    base: {
      holders: baseHolders,
      holderSource: baseHolderSource,
      holderSourceUrl: baseHolderSourceUrl,
      explorerUrl: BASESCAN_URL,
      token: baseInfoValue
    },
    chainTotal,
    chainTotalNote: 'Sum of chain holder totals; it is not a count of unique people or unique cross-chain addresses.',
    warnings
  });
}
