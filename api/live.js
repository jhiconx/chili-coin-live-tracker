const ETH_TOKEN = '0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA';
const BASE_TOKEN = '0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ETHERSCAN_URL = `https://etherscan.io/token/${ETH_TOKEN}`;
const ETHERSCAN_TX_URL = `https://etherscan.io/token/${ETH_TOKEN}#tokentxns`;
const BASESCAN_URL = `https://basescan.org/token/${BASE_TOKEN}#transactions`;
const ETHERSCAN_V2_URL = 'https://api.etherscan.io/v2/api';
const EXPLORER_API_KEY = process.env.ETHERSCAN_API_KEY || process.env.BASESCAN_API_KEY || '';
const TIMEOUT_MS = 14_000;
const TABLE_RECORD_LIMIT = 300;
const BLOCKSCOUT_LATEST_PAGES = 6;
const BASESCAN_LOG_MAX_PAGES = 10;
const ETHERSCAN_LOG_MAX_PAGES = 4;
const LOG_OFFSET = 1000;

const chainConfigs = {
  ethereum: {
    key: 'ethereum',
    label: 'Ethereum',
    chainId: '1',
    token: ETH_TOKEN,
    blockscoutApi: 'https://eth.blockscout.com/api/v2',
    compatApi: 'https://eth.blockscout.com/api',
    txExplorer: 'https://etherscan.io/tx',
    addressExplorer: 'https://etherscan.io/address',
    holderExplorer: `https://eth.blockscout.com/token/${ETH_TOKEN}`,
    transferExplorer: ETHERSCAN_TX_URL,
    sourceName: 'Ethereum Blockscout token indexer'
  },
  base: {
    key: 'base',
    label: 'Base',
    chainId: '8453',
    token: BASE_TOKEN,
    blockscoutApi: 'https://base.blockscout.com/api/v2',
    compatApi: 'https://base.blockscout.com/api',
    txExplorer: 'https://basescan.org/tx',
    addressExplorer: 'https://basescan.org/address',
    holderExplorer: `https://base.blockscout.com/token/${BASE_TOKEN}`,
    transferExplorer: BASESCAN_URL,
    sourceName: 'Base Blockscout token indexer'
  }
};

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        accept: options.accept || 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        'user-agent': 'Mozilla/5.0 (compatible; ChiliCoinLiveTracker/9.0)',
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

function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
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
      const count = asNumber(match[1]);
      if (Number.isInteger(count) && count >= 0) return count;
    }
  }
  return null;
}

async function fetchBaseScanHolderCount() {
  const pageUrl = `https://basescan.org/token/${BASE_TOKEN}`;
  const attempts = [
    { url: pageUrl, source: 'BaseScan token page' },
    { url: `https://r.jina.ai/https://basescan.org/token/${BASE_TOKEN}`, source: 'BaseScan token page via text mirror' }
  ];

  const failures = [];
  for (const attempt of attempts) {
    try {
      const response = await fetchWithTimeout(attempt.url, {
        headers: attempt.url.includes('r.jina.ai')
          ? { 'x-no-cache': 'true', 'x-return-format': 'text' }
          : { accept: 'text/html, text/plain, */*' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const content = await response.text();
      const count = parseHolderCount(content);
      if (count === null) throw new Error('holder count not present');
      return { count, source: attempt.source, sourceUrl: BASESCAN_URL };
    } catch (error) {
      failures.push(`${attempt.source}: ${error.message}`);
    }
  }

  throw new Error(failures.join(' | '));
}

async function fetchBlockscoutCounters(chain) {
  const response = await fetchWithTimeout(`${chain.blockscoutApi}/tokens/${chain.token}/counters`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return {
    holders: asNumber(data.token_holders_count ?? data.holders_count ?? data.holdersCount),
    transfers: asNumber(data.transfers_count ?? data.token_transfers_count ?? data.transfer_count),
    source: `${chain.label} Blockscout token counters`,
    sourceUrl: `${chain.blockscoutApi}/tokens/${chain.token}/counters`
  };
}

async function fetchTokenInfo(chain) {
  const response = await fetchWithTimeout(`${chain.blockscoutApi}/tokens/${chain.token}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return {
    count: asNumber(data.holders_count ?? data.holdersCount ?? data.holder_count),
    name: data.name || null,
    symbol: data.symbol || null,
    type: data.type || null,
    decimals: asNumber(data.decimals) ?? 18
  };
}

function decimalAmount(rawValue, rawDecimals) {
  const value = String(rawValue ?? '').trim();
  const decimals = Number(rawDecimals ?? 18);
  if (!/^[0-9]+$/.test(value) || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) return value || null;

  const padded = value.padStart(decimals + 1, '0');
  const whole = decimals === 0 ? padded : padded.slice(0, -decimals);
  const fraction = decimals === 0 ? '' : padded.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function getHash(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.toLowerCase();
  return String(value.hash || value.address_hash || value.address || '').toLowerCase();
}

function normalizeBlockscoutTransfer(item, chain) {
  const from = getHash(item.from);
  const to = getHash(item.to);
  const transactionHash = String(item.transaction_hash || item.transactionHash || item.hash || '').toLowerCase();
  if (!transactionHash || !from || !to) return null;

  const tokenHash = String(item.token?.address_hash || item.token?.address || chain.token).toLowerCase();
  if (tokenHash && tokenHash !== chain.token.toLowerCase()) return null;

  let event = 'Transfer';
  if (from === ZERO_ADDRESS) event = 'Mint';
  else if (to === ZERO_ADDRESS) event = 'Burn';

  const decimals = asNumber(item.total?.decimals ?? item.token?.decimals) ?? 18;
  const value = item.total?.value ?? item.value ?? item.amount;
  const logIndex = item.log_index ?? item.logIndex ?? item.index ?? '';

  return {
    chain: chain.label,
    chainKey: chain.key,
    transactionHash,
    transactionUrl: `${chain.txExplorer}/${transactionHash}`,
    blockNumber: String(item.block_number || item.blockNumber || ''),
    timestamp: item.timestamp || null,
    from,
    to,
    fromUrl: `${chain.addressExplorer}/${from}`,
    toUrl: `${chain.addressExplorer}/${to}`,
    event,
    amount: decimalAmount(value, decimals),
    amountRaw: String(value ?? ''),
    decimals,
    tokenSymbol: item.token?.symbol || 'CHI',
    sourceWallet: from,
    sourceWalletUrl: `${chain.addressExplorer}/${from}`,
    transactionInitiator: null,
    calledContract: chain.token.toLowerCase(),
    methodId: null,
    functionName: item.method || null,
    logIndex: String(logIndex),
    sourceKind: 'erc20-transfer-event',
    sourceName: `${chain.label} Blockscout token transfers`
  };
}

async function fetchBlockscoutTokenTransfers(chain, pages = BLOCKSCOUT_LATEST_PAGES) {
  let url = `${chain.blockscoutApi}/tokens/${chain.token}/transfers`;
  const transfers = [];
  const seen = new Set();
  let nextPage = null;
  let pageCount = 0;

  while (url && pageCount < pages && transfers.length < TABLE_RECORD_LIMIT) {
    pageCount += 1;
    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const items = Array.isArray(data.items) ? data.items : [];

    for (const item of items) {
      const transfer = normalizeBlockscoutTransfer(item, chain);
      if (!transfer) continue;
      const key = `${transfer.chainKey}:${transfer.transactionHash}:${transfer.logIndex || transfers.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      transfers.push(transfer);
      if (transfers.length >= TABLE_RECORD_LIMIT) break;
    }

    nextPage = data.next_page_params || null;
    if (!nextPage || typeof nextPage !== 'object' || !Object.keys(nextPage).length) break;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(nextPage)) {
      if (value !== null && value !== undefined) params.set(key, String(value));
    }
    url = `${chain.blockscoutApi}/tokens/${chain.token}/transfers?${params.toString()}`;
  }

  return {
    transfers,
    totalCount: null,
    visibleTransferCount: transfers.length,
    source: `${chain.label} Blockscout token transfers`,
    sourceUrl: `${chain.blockscoutApi}/tokens/${chain.token}/transfers`,
    capped: Boolean(nextPage)
  };
}

function hexToDecimalString(hex) {
  const clean = String(hex || '0x0').toLowerCase().replace(/^0x/, '') || '0';
  if (!/^[0-9a-f]+$/.test(clean)) return '0';
  return BigInt(`0x${clean}`).toString(10);
}

function topicToAddress(topic) {
  const clean = String(topic || '').toLowerCase().replace(/^0x/, '');
  if (clean.length < 40) return '';
  return `0x${clean.slice(-40)}`;
}

function parseHexTimestamp(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const seconds = raw.startsWith('0x') ? Number.parseInt(raw, 16) : Number(raw);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
}

function normalizeExplorerLog(item, chain) {
  const topics = Array.isArray(item.topics) ? item.topics : [];
  const from = topicToAddress(topics[1]);
  const to = topicToAddress(topics[2]);
  const transactionHash = String(item.transactionHash || item.hash || '').toLowerCase();
  if (!transactionHash || !from || !to) return null;

  let event = 'Transfer';
  if (from === ZERO_ADDRESS) event = 'Mint';
  else if (to === ZERO_ADDRESS) event = 'Burn';

  const blockNumber = item.blockNumber ? String(Number.parseInt(String(item.blockNumber), 16)) : '';
  const logIndex = item.logIndex ? String(Number.parseInt(String(item.logIndex), 16)) : '';
  const rawValue = hexToDecimalString(item.data);
  return {
    chain: chain.label,
    chainKey: chain.key,
    transactionHash,
    transactionUrl: `${chain.txExplorer}/${transactionHash}`,
    blockNumber,
    timestamp: parseHexTimestamp(item.timeStamp),
    from,
    to,
    fromUrl: `${chain.addressExplorer}/${from}`,
    toUrl: `${chain.addressExplorer}/${to}`,
    event,
    amount: decimalAmount(rawValue, 18),
    amountRaw: rawValue,
    decimals: 18,
    tokenSymbol: 'CHI',
    sourceWallet: from,
    sourceWalletUrl: `${chain.addressExplorer}/${from}`,
    transactionInitiator: null,
    calledContract: chain.token.toLowerCase(),
    methodId: null,
    functionName: null,
    logIndex,
    sourceKind: 'erc20-transfer-log',
    sourceName: `${chain.label} Etherscan/BaseScan V2 logs`
  };
}

async function etherscanV2Call(params) {
  if (!EXPLORER_API_KEY) throw new Error('ETHERSCAN_API_KEY is not configured in Vercel');
  const url = new URL(ETHERSCAN_V2_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  url.searchParams.set('apikey', EXPLORER_API_KEY);
  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (data.status === '0' && !Array.isArray(data.result)) {
    throw new Error(String(data.result || data.message || 'Etherscan V2 request failed'));
  }
  return data;
}


function normalizeExplorerTokenTx(item, chain) {
  const from = String(item.from || '').toLowerCase();
  const to = String(item.to || '').toLowerCase();
  const transactionHash = String(item.hash || item.transactionHash || '').toLowerCase();
  if (!transactionHash || !from || !to) return null;

  let event = 'Transfer';
  if (from === ZERO_ADDRESS) event = 'Mint';
  else if (to === ZERO_ADDRESS) event = 'Burn';

  const decimals = asNumber(item.tokenDecimal ?? item.tokenDecimals ?? item.decimals) ?? 18;
  const rawValue = item.value ?? item.amount ?? '0';
  const logIndex = item.logIndex ?? '';
  const ts = item.timeStamp ? new Date(Number(item.timeStamp) * 1000).toISOString() : null;

  return {
    chain: chain.label,
    chainKey: chain.key,
    transactionHash,
    transactionUrl: `${chain.txExplorer}/${transactionHash}`,
    blockNumber: String(item.blockNumber || ''),
    timestamp: ts,
    from,
    to,
    fromUrl: `${chain.addressExplorer}/${from}`,
    toUrl: `${chain.addressExplorer}/${to}`,
    event,
    amount: decimalAmount(rawValue, decimals),
    amountRaw: String(rawValue ?? ''),
    decimals,
    tokenSymbol: item.tokenSymbol || 'CHI',
    sourceWallet: from,
    sourceWalletUrl: `${chain.addressExplorer}/${from}`,
    transactionInitiator: null,
    calledContract: chain.token.toLowerCase(),
    methodId: null,
    functionName: null,
    logIndex: String(logIndex),
    sourceKind: 'erc20-token-transfer-event',
    sourceName: `${chain.label} Etherscan/BaseScan V2 token transfer events`
  };
}

async function fetchExplorerTokenTx(chain, maxPages) {
  const transfers = [];
  const seen = new Set();
  const pageSize = 1000;
  let page = 1;
  let exhausted = false;

  while (page <= maxPages) {
    const data = await etherscanV2Call({
      chainid: chain.chainId,
      module: 'account',
      action: 'tokentx',
      contractaddress: chain.token,
      page: String(page),
      offset: String(pageSize),
      sort: 'desc'
    });

    const items = Array.isArray(data.result) ? data.result : [];
    if (!items.length) {
      exhausted = true;
      break;
    }

    for (const item of items) {
      const transfer = normalizeExplorerTokenTx(item, chain);
      if (!transfer) continue;
      const key = `${transfer.chainKey}:${transfer.transactionHash}:${transfer.logIndex || transfer.from}:${transfer.to}:${transfer.amountRaw}`;
      if (seen.has(key)) continue;
      seen.add(key);
      transfers.push(transfer);
    }

    if (items.length < pageSize) {
      exhausted = true;
      break;
    }
    page += 1;
  }

  transfers.sort(sortTransfers);
  return {
    transfers: transfers.slice(0, TABLE_RECORD_LIMIT),
    totalCount: transfers.length,
    visibleTransferCount: Math.min(transfers.length, TABLE_RECORD_LIMIT),
    source: `${chain.label} ${chain.key === 'base' ? 'BaseScan' : 'Etherscan'} V2 token transfer events`,
    sourceUrl: chain.transferExplorer,
    capped: !exhausted,
    fetchedPages: page,
    exactBaseScanStyle: true
  };
}

async function fetchExplorerTransferLogs(chain, maxPages) {
  const transfers = [];
  const seen = new Set();
  let page = 1;
  let exhausted = false;

  while (page <= maxPages) {
    const data = await etherscanV2Call({
      chainid: chain.chainId,
      module: 'logs',
      action: 'getLogs',
      fromBlock: '0',
      toBlock: 'latest',
      address: chain.token,
      topic0: TRANSFER_TOPIC,
      page: String(page),
      offset: String(LOG_OFFSET)
    });

    const items = Array.isArray(data.result) ? data.result : [];
    if (!items.length) {
      exhausted = true;
      break;
    }

    for (const item of items) {
      const transfer = normalizeExplorerLog(item, chain);
      if (!transfer) continue;
      const key = `${transfer.chainKey}:${transfer.transactionHash}:${transfer.logIndex || transfers.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      transfers.push(transfer);
    }

    if (items.length < LOG_OFFSET) {
      exhausted = true;
      break;
    }
    page += 1;
  }

  transfers.sort(sortTransfers);
  return {
    transfers: transfers.slice(0, TABLE_RECORD_LIMIT),
    totalCount: transfers.length,
    visibleTransferCount: Math.min(transfers.length, TABLE_RECORD_LIMIT),
    source: `${chain.label} ${chain.key === 'base' ? 'BaseScan' : 'Etherscan'} V2 Transfer logs`,
    sourceUrl: chain.transferExplorer,
    capped: !exhausted,
    fetchedPages: page
  };
}

function sortTransfers(a, b) {
  const timeA = a.timestamp ? Date.parse(a.timestamp) : 0;
  const timeB = b.timestamp ? Date.parse(b.timestamp) : 0;
  if (timeA !== timeB) return timeB - timeA;
  const blockA = Number(a.blockNumber || 0);
  const blockB = Number(b.blockNumber || 0);
  if (blockA !== blockB) return blockB - blockA;
  return Number(b.logIndex || 0) - Number(a.logIndex || 0);
}

async function fetchBestTransferData(chain) {
  const countersResult = await Promise.allSettled([fetchBlockscoutCounters(chain)]);
  const counters = countersResult[0].status === 'fulfilled' ? countersResult[0].value : null;
  const counterError = countersResult[0].status === 'rejected' ? countersResult[0].reason?.message : null;

  if (chain.key === 'base' && EXPLORER_API_KEY) {
    try {
      const explorer = await fetchExplorerTokenTx(chain, BASESCAN_LOG_MAX_PAGES);
      return {
        ...explorer,
        totalCount: explorer.totalCount ?? counters?.transfers ?? explorer.transfers.length,
        counterCount: counters?.transfers ?? null,
        counterSource: counters?.source || null,
        counterSourceUrl: counters?.sourceUrl || null,
        warnings: [
          explorer.capped ? `BaseScan token-transfer fetch reached ${BASESCAN_LOG_MAX_PAGES} pages; the all-time Base count may be higher than the loaded count.` : null,
          counterError ? `Base Blockscout counter unavailable: ${counterError}` : null
        ].filter(Boolean)
      };
    } catch (error) {
      const fallback = await fetchBlockscoutTokenTransfers(chain);
      return {
        ...fallback,
        totalCount: counters?.transfers ?? fallback.transfers.length,
        counterCount: counters?.transfers ?? null,
        counterSource: counters?.source || null,
        counterSourceUrl: counters?.sourceUrl || null,
        warnings: [`BaseScan/Etherscan V2 token-transfer source failed, using Blockscout fallback: ${error.message}`]
      };
    }
  }

  const fallback = await fetchBlockscoutTokenTransfers(chain);
  return {
    ...fallback,
    totalCount: counters?.transfers ?? fallback.transfers.length,
    counterCount: counters?.transfers ?? null,
    counterSource: counters?.source || null,
    counterSourceUrl: counters?.sourceUrl || null,
    warnings: [
      counterError ? `${chain.label} Blockscout counter unavailable: ${counterError}` : null,
      chain.key === 'base' && !EXPLORER_API_KEY
        ? 'BaseScan exact mode is not active because ETHERSCAN_API_KEY is not configured in Vercel. Base rows use Blockscout public token-transfer data and link back to BaseScan.'
        : null
    ].filter(Boolean)
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestUrl = new URL(req.url || '/', 'https://chili-coin.local');
  const force = requestUrl.searchParams.get('force') === '1';
  res.setHeader('Cache-Control', force ? 'no-store, max-age=0' : 's-maxage=8, stale-while-revalidate=12');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const fetchedAt = new Date().toISOString();
  const [ethCounters, baseCounters, ethToken, baseToken, ethTransfers, baseTransfers] = await Promise.allSettled([
    fetchBlockscoutCounters(chainConfigs.ethereum),
    fetchBlockscoutCounters(chainConfigs.base),
    fetchTokenInfo(chainConfigs.ethereum),
    fetchTokenInfo(chainConfigs.base),
    fetchBestTransferData(chainConfigs.ethereum),
    fetchBestTransferData(chainConfigs.base)
  ]);

  const warnings = [];
  const ethCounterValue = ethCounters.status === 'fulfilled' ? ethCounters.value : null;
  const baseCounterValue = baseCounters.status === 'fulfilled' ? baseCounters.value : null;
  const ethTokenValue = ethToken.status === 'fulfilled' ? ethToken.value : null;
  const baseTokenValue = baseToken.status === 'fulfilled' ? baseToken.value : null;
  const ethTransferValue = ethTransfers.status === 'fulfilled' ? ethTransfers.value : null;
  const baseTransferValue = baseTransfers.status === 'fulfilled' ? baseTransfers.value : null;

  if (ethCounters.status === 'rejected') warnings.push(`Ethereum counter unavailable: ${ethCounters.reason?.message || 'unknown error'}`);
  if (baseCounters.status === 'rejected') warnings.push(`Base counter unavailable: ${baseCounters.reason?.message || 'unknown error'}`);
  if (ethToken.status === 'rejected') warnings.push(`Ethereum token metadata unavailable: ${ethToken.reason?.message || 'unknown error'}`);
  if (baseToken.status === 'rejected') warnings.push(`Base token metadata unavailable: ${baseToken.reason?.message || 'unknown error'}`);
  if (ethTransfers.status === 'rejected') warnings.push(`Ethereum CHI transfer feed unavailable: ${ethTransfers.reason?.message || 'unknown error'}`);
  if (baseTransfers.status === 'rejected') warnings.push(`Base CHI transfer feed unavailable: ${baseTransfers.reason?.message || 'unknown error'}`);
  if (Array.isArray(ethTransferValue?.warnings)) warnings.push(...ethTransferValue.warnings);
  if (Array.isArray(baseTransferValue?.warnings)) warnings.push(...baseTransferValue.warnings);

  let baseHolders = Number.isFinite(baseCounterValue?.holders) ? baseCounterValue.holders : null;
  let baseHolderSource = baseHolders !== null ? 'Base Blockscout token counters' : null;
  let baseHolderSourceUrl = baseCounterValue?.sourceUrl || BASESCAN_URL;

  const ethHolders = Number.isFinite(ethCounterValue?.holders)
    ? ethCounterValue.holders
    : (Number.isFinite(ethTokenValue?.count) ? ethTokenValue.count : null);
  const chainTotal = Number.isFinite(ethHolders) && Number.isFinite(baseHolders)
    ? ethHolders + baseHolders
    : null;

  const ethTransferRows = Array.isArray(ethTransferValue?.transfers) ? ethTransferValue.transfers : [];
  const baseTransferRows = Array.isArray(baseTransferValue?.transfers) ? baseTransferValue.transfers : [];
  const ethTransferTotal = Number.isFinite(ethTransferValue?.totalCount)
    ? ethTransferValue.totalCount
    : (Number.isFinite(ethCounterValue?.transfers) ? ethCounterValue.transfers : ethTransferRows.length);
  const baseTransferTotal = Number.isFinite(baseTransferValue?.totalCount)
    ? baseTransferValue.totalCount
    : (Number.isFinite(baseCounterValue?.transfers) ? baseCounterValue.transfers : baseTransferRows.length);
  const allTransferTotal = ethTransferTotal + baseTransferTotal;
  const allTransfers = [...ethTransferRows, ...baseTransferRows].sort(sortTransfers).slice(0, TABLE_RECORD_LIMIT);

  return res.status(200).json({
    ok: Boolean(baseHolders !== null || ethHolders !== null || allTransfers.length),
    fetchedAt,
    refreshSeconds: 20,
    contracts: {
      ethereumToken: ETH_TOKEN,
      baseToken: BASE_TOKEN
    },
    dataMode: {
      baseScanExactMode: Boolean(EXPLORER_API_KEY && baseTransferValue?.source?.includes('BaseScan')),
      explorerApiKeyConfigured: Boolean(EXPLORER_API_KEY),
      note: EXPLORER_API_KEY
        ? 'Base transfer rows use Etherscan/BaseScan V2 ERC-20 token-transfer events when available, with Blockscout only as a labeled fallback.'
        : 'BaseScan exact mode is off. Add ETHERSCAN_API_KEY in Vercel to query the official Etherscan/BaseScan V2 ERC-20 token-transfer endpoint server-side.'
    },
    ethereum: {
      holders: ethHolders,
      holderSource: ethCounterValue ? ethCounterValue.source : (ethTokenValue ? 'Ethereum Blockscout token metadata' : null),
      holderSourceUrl: ethCounterValue?.sourceUrl || chainConfigs.ethereum.holderExplorer,
      explorerUrl: ETHERSCAN_URL,
      transferExplorerUrl: ETHERSCAN_TX_URL,
      token: ethTokenValue,
      transfers: ethTransferRows,
      transferCount: ethTransferTotal,
      visibleTransferCount: ethTransferRows.length,
      transferSource: ethTransferValue?.source || null,
      transferSourceUrl: ethTransferValue?.sourceUrl || null
    },
    base: {
      holders: baseHolders,
      holderSource: baseHolderSource,
      holderSourceUrl: baseHolderSourceUrl,
      explorerUrl: BASESCAN_URL,
      token: baseTokenValue,
      transfers: baseTransferRows,
      transferCount: baseTransferTotal,
      visibleTransferCount: baseTransferRows.length,
      transferSource: baseTransferValue?.source || null,
      transferSourceUrl: baseTransferValue?.sourceUrl || BASESCAN_URL,
      transferExplorerUrl: BASESCAN_URL,
      counterCount: baseTransferValue?.counterCount ?? baseCounterValue?.transfers ?? null
    },
    transactions: {
      totalCount: allTransferTotal,
      latestCount: allTransfers.length,
      ethereumTotalCount: ethTransferTotal,
      baseTotalCount: baseTransferTotal,
      ethereumLatestCount: ethTransferRows.length,
      baseLatestCount: baseTransferRows.length,
      label: 'All Chain Transactions',
      note: 'The TXN card counts indexed ERC-20 token Transfer events. Base rows use the BaseScan/Etherscan V2 tokentx event feed when configured: Source Wallet is the CHI From wallet, Recipient is the CHI To wallet, and Amount is decoded from the token transfer event value.',
      records: allTransfers,
      sources: [
        ethTransferValue?.source || null,
        baseTransferValue?.source || null,
        ethTransferValue?.counterSource || null,
        baseTransferValue?.counterSource || null
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
