const ETH_TOKEN = '0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA';
const BASE_TOKEN = '0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ETHERSCAN_URL = `https://etherscan.io/token/${ETH_TOKEN}`;
const ETHERSCAN_TX_URL = `https://etherscan.io/token/${ETH_TOKEN}#tokentxns`;
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
        'user-agent': 'Mozilla/5.0 (compatible; ChiliCoinLiveTracker/6.0)',
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

function normalizeTransfer(item, chain) {
  const token = chain.token.toLowerCase();
  const from = String(item.from || '').toLowerCase();
  const to = String(item.to || '').toLowerCase();
  const transactionHash = String(item.hash || item.transactionHash || '').toLowerCase();
  const contractAddress = String(item.contractAddress || chain.token).toLowerCase();
  if (contractAddress !== token) return null;
  if (!transactionHash || !from || !to) return null;

  let event = 'Transfer';
  if (from === ZERO_ADDRESS) event = 'Mint';
  else if (to === ZERO_ADDRESS) event = 'Burn';

  return {
    chain: chain.label,
    chainKey: chain.key,
    transactionHash,
    transactionUrl: `${chain.txExplorer}/${transactionHash}`,
    blockNumber: String(item.blockNumber || ''),
    timestamp: item.timeStamp ? new Date(Number(item.timeStamp) * 1000).toISOString() : null,
    from,
    to,
    fromUrl: `${chain.addressExplorer}/${from}`,
    toUrl: `${chain.addressExplorer}/${to}`,
    event,
    amount: decimalAmount(item.value, item.tokenDecimal),
    amountRaw: String(item.value ?? ''),
    decimals: Number(item.tokenDecimal ?? 18),
    tokenSymbol: item.tokenSymbol || 'CHI'
  };
}

async function fetchTokenTransfers(chain, offset = '100') {
  const params = new URLSearchParams({
    module: 'account',
    action: 'tokentx',
    contractaddress: chain.token,
    page: '1',
    offset,
    sort: 'desc'
  });
  const url = `${chain.compatApi}?${params.toString()}`;
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
    const transfer = normalizeTransfer(item, chain);
    if (!transfer) continue;
    const key = `${transfer.chainKey}:${transfer.transactionHash}:${item.logIndex || item.transactionIndex || transfers.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    transfers.push(transfer);
    if (transfers.length >= Number(offset)) break;
  }

  return {
    transfers,
    source: chain.source,
    sourceUrl: chain.sourceUrl,
    explorerUrl: chain.explorerUrl
  };
}

function sortTransfers(a, b) {
  const timeA = a.timestamp ? Date.parse(a.timestamp) : 0;
  const timeB = b.timestamp ? Date.parse(b.timestamp) : 0;
  if (timeA !== timeB) return timeB - timeA;
  return Number(b.blockNumber || 0) - Number(a.blockNumber || 0);
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
  const chainConfigs = {
    ethereum: {
      key: 'ethereum',
      label: 'Ethereum',
      token: ETH_TOKEN,
      compatApi: 'https://eth.blockscout.com/api',
      txExplorer: 'https://etherscan.io/tx',
      addressExplorer: 'https://etherscan.io/address',
      source: 'Ethereum Blockscout ERC-20 indexer',
      sourceUrl: `https://eth.blockscout.com/token/${ETH_TOKEN}?tab=token_transfers`,
      explorerUrl: ETHERSCAN_TX_URL
    },
    base: {
      key: 'base',
      label: 'Base',
      token: BASE_TOKEN,
      compatApi: 'https://base.blockscout.com/api',
      txExplorer: 'https://basescan.org/tx',
      addressExplorer: 'https://basescan.org/address',
      source: 'Base Blockscout ERC-20 indexer',
      sourceUrl: `https://base.blockscout.com/token/${BASE_TOKEN}?tab=token_transfers`,
      explorerUrl: BASESCAN_URL
    }
  };

  const [baseScan, ethInfo, baseInfo, ethTransfers, baseTransfers] = await Promise.allSettled([
    fetchBaseScanHolderCount(),
    fetchTokenInfo('https://eth.blockscout.com/api/v2', ETH_TOKEN),
    fetchTokenInfo('https://base.blockscout.com/api/v2', BASE_TOKEN),
    fetchTokenTransfers(chainConfigs.ethereum, '100'),
    fetchTokenTransfers(chainConfigs.base, '100')
  ]);

  const warnings = [];
  const baseScanValue = baseScan.status === 'fulfilled' ? baseScan.value : null;
  const ethValue = ethInfo.status === 'fulfilled' ? ethInfo.value : null;
  const baseInfoValue = baseInfo.status === 'fulfilled' ? baseInfo.value : null;
  const ethTransferValue = ethTransfers.status === 'fulfilled' ? ethTransfers.value : null;
  const baseTransferValue = baseTransfers.status === 'fulfilled' ? baseTransfers.value : null;

  if (!baseScanValue) warnings.push(`BaseScan holder count unavailable: ${baseScan.reason?.message || 'unknown error'}`);
  if (!ethValue) warnings.push(`Ethereum holder count unavailable: ${ethInfo.reason?.message || 'unknown error'}`);
  if (!baseInfoValue) warnings.push(`Base token metadata unavailable: ${baseInfo.reason?.message || 'unknown error'}`);
  if (!ethTransferValue) warnings.push(`Ethereum CHI transfer feed unavailable: ${ethTransfers.reason?.message || 'unknown error'}`);
  if (!baseTransferValue) warnings.push(`Base CHI transfer feed unavailable: ${baseTransfers.reason?.message || 'unknown error'}`);

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

  const ethTransferRows = ethTransferValue?.transfers || [];
  const baseTransferRows = baseTransferValue?.transfers || [];
  const allTransfers = [...ethTransferRows, ...baseTransferRows].sort(sortTransfers).slice(0, 150);

  return res.status(200).json({
    ok: Boolean(baseHolders !== null || ethHolders !== null || allTransfers.length),
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
      transferExplorerUrl: ETHERSCAN_TX_URL,
      token: ethValue,
      transfers: ethTransferRows,
      transferCount: ethTransferRows.length,
      transferSource: ethTransferValue?.source || null,
      transferSourceUrl: ethTransferValue?.sourceUrl || null
    },
    base: {
      holders: baseHolders,
      holderSource: baseHolderSource,
      holderSourceUrl: baseHolderSourceUrl,
      explorerUrl: BASESCAN_URL,
      token: baseInfoValue,
      transfers: baseTransferRows,
      transferCount: baseTransferRows.length,
      transferSource: baseTransferValue?.source || null,
      transferSourceUrl: baseTransferValue?.sourceUrl || null,
      transferExplorerUrl: BASESCAN_URL
    },
    transactions: {
      latestCount: allTransfers.length,
      ethereumLatestCount: ethTransferRows.length,
      baseLatestCount: baseTransferRows.length,
      label: 'All Chain Transactions',
      note: 'This is the latest indexed transfer-event count loaded from public ETH and Base indexers, not a verified all-time transaction total.',
      records: allTransfers,
      sources: [
        ethTransferValue?.source || null,
        baseTransferValue?.source || null
      ].filter(Boolean),
      explorerLinks: {
        ethereum: ETHERSCAN_TX_URL,
        base: BASESCAN_URL
      }
    },
    chainTotal,
    chainTotalNote: 'Sum of chain holder totals; it is not a count of unique people or unique cross-chain addresses.',
    warnings
  });
}
