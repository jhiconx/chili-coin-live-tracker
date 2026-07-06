const ETH_TOKEN = '0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA';
const BASE_TOKEN = '0x65aa05778b093ea8f3ecdaff6f070a30eb15c3d3';
const BASE_WALLET = '0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const BASESCAN_URL = `https://basescan.org/token/${BASE_TOKEN}?a=${BASE_WALLET}#transactions`;

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
        'user-agent': 'Mozilla/5.0 (compatible; ChiliCoinLiveTracker/1.0; +https://basescan.org)',
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
  const directUrl = `https://basescan.org/token/${BASE_TOKEN}?a=${BASE_WALLET}`;
  const attempts = [
    { url: directUrl, source: 'BaseScan' },
    { url: `https://r.jina.ai/https://basescan.org/token/${BASE_TOKEN}?a=${BASE_WALLET}`, source: 'BaseScan via text mirror' }
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

function addressHash(value) {
  if (!value) return '';
  return String(typeof value === 'string' ? value : value.hash || value.address_hash || '').toLowerCase();
}

function normalizeTransfer(item) {
  const from = addressHash(item.from);
  const to = addressHash(item.to);
  const tokenAddress = addressHash(item.token?.address_hash || item.token?.address || item.contractAddress);
  if (tokenAddress && tokenAddress !== BASE_TOKEN.toLowerCase()) return null;

  let direction = 'Transfer';
  if (from === ZERO_ADDRESS) direction = 'Mint';
  else if (to === ZERO_ADDRESS) direction = 'Burn';
  else if (from === BASE_WALLET.toLowerCase()) direction = 'Sent';
  else if (to === BASE_WALLET.toLowerCase()) direction = 'Received';

  const tokenIds = item.token_ids || item.tokenIDs || item.ids || [];
  const tokenId = item.token_id ?? item.tokenID ?? item.id ?? (Array.isArray(tokenIds) ? tokenIds[0] : null);
  const amount = item.total?.value ?? item.value ?? item.amount ?? item.values?.[0] ?? null;
  const timestamp = item.timestamp || item.timeStamp || item.block_timestamp || null;
  const transactionHash = item.transaction_hash || item.hash || item.transactionHash || '';
  const counterparty = direction === 'Sent' || direction === 'Burn' ? to : from;

  return {
    transactionHash,
    timestamp,
    from,
    to,
    counterparty,
    direction,
    tokenId: tokenId === null || tokenId === undefined ? null : String(tokenId),
    amount: amount === null || amount === undefined ? null : String(amount),
    method: item.method || item.method_name || null
  };
}

async function fetchBaseTransfers() {
  const root = `https://base.blockscout.com/api/v2/addresses/${BASE_WALLET}/token-transfers`;
  const fixed = new URLSearchParams({
    type: 'ERC-1155',
    token: BASE_TOKEN,
    filter: 'to | from'
  });

  let url = `${root}?${fixed.toString()}`;
  const seen = new Set();
  const transfers = [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let activity24h = 0;
  let scannedAllRecent = false;

  for (let page = 0; page < 10 && url; page += 1) {
    if (seen.has(url)) break;
    seen.add(url);

    const response = await fetchWithTimeout(url, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) break;

    let pageHasOldRecord = false;
    for (const item of items) {
      const transfer = normalizeTransfer(item);
      if (!transfer) continue;
      if (transfers.length < 30) transfers.push(transfer);
      const time = transfer.timestamp ? new Date(transfer.timestamp).getTime() : NaN;
      if (Number.isFinite(time) && time >= cutoff) activity24h += 1;
      if (Number.isFinite(time) && time < cutoff) pageHasOldRecord = true;
    }

    if (pageHasOldRecord) {
      scannedAllRecent = true;
      break;
    }

    const next = data.next_page_params;
    if (!next || !Object.keys(next).length) {
      scannedAllRecent = true;
      break;
    }
    const params = new URLSearchParams(fixed);
    Object.entries(next).forEach(([key, value]) => {
      if (value !== null && value !== undefined) params.set(key, String(value));
    });
    url = `${root}?${params.toString()}`;
  }

  return {
    transfers,
    activity24h,
    activity24hComplete: scannedAllRecent,
    source: 'Base Blockscout',
    sourceUrl: `https://base.blockscout.com/address/${BASE_WALLET}?tab=token_transfers`
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
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
  const transfersValue = baseTransfers.status === 'fulfilled' ? baseTransfers.value : null;

  if (!baseScanValue) warnings.push(`BaseScan holder count unavailable: ${baseScan.reason?.message || 'unknown error'}`);
  if (!ethValue) warnings.push(`Ethereum holder count unavailable: ${ethInfo.reason?.message || 'unknown error'}`);
  if (!baseInfoValue) warnings.push(`Base token metadata unavailable: ${baseInfo.reason?.message || 'unknown error'}`);
  if (!transfersValue) warnings.push(`Base transfer feed unavailable: ${baseTransfers.reason?.message || 'unknown error'}`);

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
    ok: Boolean(baseHolders !== null || ethHolders !== null || transfersValue),
    fetchedAt,
    refreshSeconds: 20,
    contracts: {
      ethereumToken: ETH_TOKEN,
      baseToken: BASE_TOKEN,
      baseCustodialWallet: BASE_WALLET
    },
    ethereum: {
      holders: ethHolders,
      holderSource: ethValue ? 'Ethereum Blockscout' : null,
      holderSourceUrl: `https://eth.blockscout.com/token/${ETH_TOKEN}`,
      explorerUrl: `https://etherscan.io/token/${ETH_TOKEN}`,
      token: ethValue
    },
    base: {
      holders: baseHolders,
      holderSource: baseHolderSource,
      holderSourceUrl: baseHolderSourceUrl,
      baseScanUrl: BASESCAN_URL,
      token: baseInfoValue,
      transfers: transfersValue?.transfers || [],
      activity24h: transfersValue?.activity24h ?? null,
      activity24hComplete: transfersValue?.activity24hComplete ?? false,
      transferSource: transfersValue?.source ?? null,
      transferSourceUrl: transfersValue?.sourceUrl ?? null
    },
    chainTotal,
    chainTotalNote: 'Sum of chain holder totals; it is not a count of unique people or unique cross-chain addresses.',
    warnings
  });
}
