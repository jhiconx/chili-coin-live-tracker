const ETH_TOKEN = '0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA';
const BASE_TOKEN = '0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
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
        'user-agent': 'Mozilla/5.0 (compatible; ChiliCoinLiveTracker/3.0)',
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

function decimalAmount(rawValue, rawDecimals) {
  const value = String(rawValue ?? '').trim();
  const decimals = Number(rawDecimals ?? 18);
  if (!/^\d+$/.test(value) || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) return value || null;

  const padded = value.padStart(decimals + 1, '0');
  const whole = decimals === 0 ? padded : padded.slice(0, -decimals);
  const fraction = decimals === 0 ? '' : padded.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function normalizeTransfer(item) {
  const from = String(item.from || '').toLowerCase();
  const to = String(item.to || '').toLowerCase();
  const transactionHash = String(item.hash || item.transactionHash || '').toLowerCase();
  const contractAddress = String(item.contractAddress || BASE_TOKEN).toLowerCase();
  if (contractAddress !== BASE_TOKEN.toLowerCase()) return null;
  if (!transactionHash || !from || !to) return null;

  let event = 'Transfer';
  if (from === ZERO_ADDRESS) event = 'Mint';
  else if (to === ZERO_ADDRESS) event = 'Burn';

  return {
    transactionHash,
    blockNumber: String(item.blockNumber || ''),
    timestamp: item.timeStamp ? new Date(Number(item.timeStamp) * 1000).toISOString() : null,
    from,
    to,
    event,
    amount: decimalAmount(item.value, item.tokenDecimal),
    amountRaw: String(item.value ?? ''),
    decimals: Number(item.tokenDecimal ?? 18),
    tokenSymbol: item.tokenSymbol || 'CHI'
  };
}

async function fetchBaseTransfers() {
  // Blockscout's account/tokentx endpoint accepts contractaddress by itself,
  // returning recent ERC-20 transfers for that token across the Base chain.
  const params = new URLSearchParams({
    module: 'account',
    action: 'tokentx',
    contractaddress: BASE_TOKEN,
    page: '1',
    offset: '100',
    sort: 'desc'
  });
  const url = `https://base.blockscout.com/api?${params.toString()}`;
  const response = await fetchWithTimeout(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();
  const result = Array.isArray(data.result) ? data.result : [];
  if (!result.length && data.status !== '1') {
    throw new Error(String(data.message || data.result || 'No transfer records returned'));
  }

  const seen = new Set();
  const transfers = [];
  for (const item of result) {
    const transfer = normalizeTransfer(item);
    if (!transfer) continue;
    const key = `${transfer.transactionHash}:${item.logIndex || item.transactionIndex || transfers.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    transfers.push(transfer);
    if (transfers.length >= 50) break;
  }

  return {
    transfers,
    source: 'Base Blockscout ERC-20 indexer',
    sourceUrl: `https://base.blockscout.com/token/${BASE_TOKEN}?tab=token_transfers`,
    explorerUrl: BASESCAN_URL
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestUrl = new URL(req.url || '/', 'https://chili-coin.local');
  const force = requestUrl.searchParams.get('force') === '1';
  res.setHeader('Cache-Control', force ? 'no-store, max-age=0' : 's-maxage=10, stale-while-revalidate=20');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const fetchedAt = new Date().toISOString();
  const [baseScan, ethInfo, baseInfo, baseTransfers] = await Promise.allSettled([
    fetchBaseScanHolderCount(),
    fetchTokenInfo('https://eth.blockscout.com/api/v2', ETH_TOKEN),
    fetchTokenInfo('https://base.blockscout.com/api/v2', BASE_TOKEN),
    fetchBaseTransfers()
  ]);

  const warnings = [];
  const baseScanValue = baseScan.status === 'fulfilled' ? baseScan.value : null;
  const ethValue = ethInfo.status === 'fulfilled' ? ethInfo.value : null;
  const baseInfoValue = baseInfo.status === 'fulfilled' ? baseInfo.value : null;
  const transferValue = baseTransfers.status === 'fulfilled' ? baseTransfers.value : null;

  if (!baseScanValue) warnings.push(`BaseScan holder count unavailable: ${baseScan.reason?.message || 'unknown error'}`);
  if (!ethValue) warnings.push(`Ethereum holder count unavailable: ${ethInfo.reason?.message || 'unknown error'}`);
  if (!baseInfoValue) warnings.push(`Base token metadata unavailable: ${baseInfo.reason?.message || 'unknown error'}`);
  if (!transferValue) warnings.push(`Base CHI transfer feed unavailable: ${baseTransfers.reason?.message || 'unknown error'}`);

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
    ok: Boolean(baseHolders !== null || ethHolders !== null || transferValue),
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
      token: baseInfoValue,
      transfers: transferValue?.transfers || [],
      transferSource: transferValue?.source || null,
      transferSourceUrl: transferValue?.sourceUrl || null,
      transferExplorerUrl: transferValue?.explorerUrl || BASESCAN_URL
    },
    chainTotal,
    chainTotalNote: 'Sum of chain holder totals; it is not a count of unique people or unique cross-chain addresses.',
    warnings
  });
}
