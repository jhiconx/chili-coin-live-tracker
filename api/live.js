const ETH_TOKEN = '0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA';
const BASE_TOKEN = '0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ETHERSCAN_URL = `https://etherscan.io/token/${ETH_TOKEN}`;
const ETHERSCAN_TX_URL = `https://etherscan.io/token/${ETH_TOKEN}#tokentxns`;
const BASESCAN_URL = `https://basescan.org/token/${BASE_TOKEN}#transactions`;
const BASESCAN_TOKEN_URL = `https://basescan.org/token/${BASE_TOKEN}`;

// V17: official transfer-count fix.
// Holder cards and the TXN card are calculated separately from the latest visible table rows.
// With ETHERSCAN_API_KEY configured, the all-chain TXN card counts all indexed ERC-20 Transfer events by asking Etherscan/BaseScan for the full token-transfer list count.
// The table still fetches only a small latest-row page so the site stays responsive.
const FAST_TIMEOUT_MS = 5_500;
const EXPLORER_TIMEOUT_MS = 8_500;
const BASESCAN_HINT_TIMEOUT_MS = 2_500;
const TABLE_RECORD_LIMIT = 300;
const TX_ROW_OFFSET = 300;
const TRANSFER_PAGES = 3;

const chainConfigs = {
  ethereum: {
    key: 'ethereum',
    label: 'Ethereum',
    token: ETH_TOKEN,
    blockscoutApi: 'https://eth.blockscout.com/api/v2',
    txExplorer: 'https://etherscan.io/tx',
    addressExplorer: 'https://etherscan.io/address',
    holderExplorer: `https://eth.blockscout.com/token/${ETH_TOKEN}`,
    transferExplorer: ETHERSCAN_TX_URL,
    sourceName: 'Ethereum Blockscout public indexer'
  },
  base: {
    key: 'base',
    label: 'Base',
    token: BASE_TOKEN,
    blockscoutApi: 'https://base.blockscout.com/api/v2',
    txExplorer: 'https://basescan.org/tx',
    addressExplorer: 'https://basescan.org/address',
    holderExplorer: `https://base.blockscout.com/token/${BASE_TOKEN}`,
    transferExplorer: BASESCAN_URL,
    sourceName: 'Base Blockscout public indexer'
  }
};

function timeoutError(ms, label) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FAST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        accept: options.accept || 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        'user-agent': 'Mozilla/5.0 (compatible; ChiliCoinLiveTracker/12.0)',
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs = FAST_TIMEOUT_MS) {
  const response = await fetchWithTimeout(url, {}, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function getExplorerApiKey() {
  const raw = String(process.env.ETHERSCAN_API_KEY || process.env.BASESCAN_API_KEY || '').trim();
  if (!raw) return null;
  if (/^sk_live/i.test(raw)) return null;
  return raw;
}

function chainIdFor(chain) {
  return chain.key === 'base' ? '8453' : '1';
}

async function fetchEtherscanV2(params, timeoutMs = EXPLORER_TIMEOUT_MS) {
  const apiKey = getExplorerApiKey();
  if (!apiKey) throw new Error('ETHERSCAN_API_KEY is not configured or is not a valid Etherscan key');
  const url = new URL('https://api.etherscan.io/v2/api');
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  url.searchParams.set('apikey', apiKey);
  const data = await fetchJson(url.toString(), timeoutMs);
  if (data.status === '1') return data.result;
  const message = data.message || data.result || 'Etherscan API request failed';
  throw new Error(String(message));
}

async function fetchEtherscanHolderCount(chain) {
  const result = await fetchEtherscanV2({
    chainid: chainIdFor(chain),
    module: 'token',
    action: 'tokenholdercount',
    contractaddress: chain.token
  });
  return {
    holders: asNumber(result),
    transfers: null,
    source: `${chain.label} Etherscan API tokenholdercount`,
    sourceUrl: chain.key === 'base' ? BASESCAN_TOKEN_URL : ETHERSCAN_URL
  };
}

async function fetchEtherscanTokenTransferCount(chain) {
  const result = await fetchEtherscanV2({
    chainid: chainIdFor(chain),
    module: 'account',
    action: 'tokentx',
    contractaddress: chain.token,
    startblock: 0,
    endblock: 99999999,
    page: 1,
    offset: 10000,
    sort: 'desc'
  }, EXPLORER_TIMEOUT_MS * 3);
  const items = Array.isArray(result) ? result : [];
  return {
    holders: null,
    transfers: items.length,
    source: items.length >= 10000 ? `${chain.label} Etherscan API tokentx transfer count capped at 10000` : `${chain.label} Etherscan API tokentx transfer count`,
    sourceUrl: chain.transferExplorer
  };
}

function mergeCounterResults(results, fallbackSourceUrl = null) {
  const fulfilled = results
    .filter(result => result && result.status === 'fulfilled' && result.value)
    .map(result => result.value);

  let holders = null;
  let holderSource = null;
  let holderSourceUrl = null;
  let transfers = null;
  let transferSource = null;
  let transferSourceUrl = null;

  for (const value of fulfilled) {
    if (Number.isFinite(value.holders)) {
      if (!Number.isFinite(holders) || value.holders > holders) {
        holders = value.holders;
        holderSource = value.source || holderSource;
        holderSourceUrl = value.sourceUrl || holderSourceUrl;
      }
    }
    if (Number.isFinite(value.transfers)) {
      if (!Number.isFinite(transfers) || value.transfers > transfers) {
        transfers = value.transfers;
        transferSource = value.source || transferSource;
        transferSourceUrl = value.sourceUrl || transferSourceUrl;
      }
    }
  }

  if (!Number.isFinite(holders) && !Number.isFinite(transfers)) return null;

  const sources = Array.from(new Set([holderSource, transferSource].filter(Boolean)));
  return {
    holders,
    transfers,
    source: sources.join(' + ') || 'Explorer counter sources',
    sourceUrl: holderSourceUrl || transferSourceUrl || fallbackSourceUrl,
    holderSource,
    holderSourceUrl,
    transferSource,
    transferSourceUrl
  };
}

function normalizeEtherscanTokenTx(item, chain) {
  const from = String(item.from || '').toLowerCase();
  const to = String(item.to || '').toLowerCase();
  const transactionHash = String(item.hash || '').toLowerCase();
  if (!transactionHash || !from || !to) return null;
  const tokenHash = String(item.contractAddress || item.contractaddress || chain.token).toLowerCase();
  if (tokenHash && tokenHash !== chain.token.toLowerCase()) return null;

  let event = 'Transfer';
  if (from === ZERO_ADDRESS) event = 'Mint';
  else if (to === ZERO_ADDRESS) event = 'Burn';

  const decimals = asNumber(item.tokenDecimal ?? item.tokenDecimals ?? item.decimals) ?? 18;
  const timestamp = item.timeStamp ? new Date(Number(item.timeStamp) * 1000).toISOString() : null;
  const logIndex = item.logIndex ?? item.transactionIndex ?? item.nonce ?? '';

  return {
    chain: chain.label,
    chainKey: chain.key,
    transactionHash,
    transactionUrl: `${chain.txExplorer}/${transactionHash}`,
    blockNumber: String(item.blockNumber || ''),
    timestamp,
    from,
    to,
    fromUrl: `${chain.addressExplorer}/${from}`,
    toUrl: `${chain.addressExplorer}/${to}`,
    event,
    amount: decimalAmount(item.value, decimals),
    amountRaw: String(item.value ?? ''),
    decimals,
    tokenSymbol: item.tokenSymbol || 'CHI',
    sourceWallet: from,
    sourceWalletUrl: `${chain.addressExplorer}/${from}`,
    transactionInitiator: null,
    calledContract: chain.token.toLowerCase(),
    methodId: null,
    functionName: item.functionName || null,
    logIndex: String(logIndex),
    sourceKind: 'erc20-transfer-event',
    sourceName: `${chain.label} Etherscan API token transfers`
  };
}

async function fetchEtherscanTokenTransfers(chain) {
  const offset = TX_ROW_OFFSET;
  const result = await fetchEtherscanV2({
    chainid: chainIdFor(chain),
    module: 'account',
    action: 'tokentx',
    contractaddress: chain.token,
    startblock: 0,
    endblock: 99999999,
    page: 1,
    offset,
    sort: 'desc'
  }, EXPLORER_TIMEOUT_MS * 2);
  const items = Array.isArray(result) ? result : [];
  const transfers = [];
  const seen = new Set();
  for (const item of items) {
    const transfer = normalizeEtherscanTokenTx(item, chain);
    if (!transfer) continue;
    const key = `${transfer.chainKey}:${transfer.transactionHash}:${transfer.logIndex || transfer.from}:${transfer.to}:${transfer.amountRaw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (transfers.length < TABLE_RECORD_LIMIT) transfers.push(transfer);
  }
  return {
    transfers,
    visibleTransferCount: transfers.length,
    // If we hit the requested row limit, the explorer has more rows than we loaded.
    // Leave totalTransferCount null so the card can use the separate official transfer total.
    totalTransferCount: items.length < offset ? items.length : null,
    source: `${chain.label} Etherscan API ERC-20 tokentx latest rows`,
    sourceUrl: chain.transferExplorer,
    capped: items.length >= offset
  };
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

function parseBaseScanTextCount(content, kind) {
  const raw = String(content || '');
  const plain = toPlainText(raw);
  const holderPatterns = [
    /\bHolders\b\s*([\d,]+)/i,
    /####\s*Holders\s*([\d,]+)/i,
    /Holders[\s\S]{0,300}?>([\d,]+)</i
  ];
  const transferPatterns = [
    /A\s+total\s+of\s+([\d,]+)\s+token\s+transfers?\s+found/i,
    /A\s+total\s+of\s+([\d,]+)\s+transactions?\s+found/i,
    /A\s+total\s+of\s+([\d,]+)\s+transfers?\s+found/i,
    /([\d,]+)\s+token\s+transfers?\s+found/i,
    /([\d,]+)\s+transactions?\s+found/i,
    /([\d,]+)\s+transfers?\s+found/i,
    /\bTransfers\b\s*(?:Total\s*)?([\d,]+)/i,
    /\bTransactions\b\s*(?:Total\s*)?([\d,]+)/i
  ];
  const patterns = kind === 'holders' ? holderPatterns : transferPatterns;
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

function getManualNumber(name) {
  const value = process.env[name];
  const parsed = asNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchBaseScanPageSummary(timeoutMs = 12_000) {
  // Jina Reader converts the public BaseScan token page to readable text.
  // This is slower than an API call, so Vercel caches the server response; but it matches the public BaseScan overview when API holder count is unavailable.
  const url = `https://r.jina.ai/${BASESCAN_TOKEN_URL}`;
  const response = await fetchWithTimeout(url, {
    headers: {
      accept: 'text/plain, text/markdown, */*',
      'x-respond-with': 'text',
      'x-no-cache': 'true'
    }
  }, timeoutMs);
  if (!response.ok) throw new Error(`BaseScan text mirror HTTP ${response.status}`);
  const content = await response.text();
  const holders = parseBaseScanTextCount(content, 'holders');
  const transfers = parseBaseScanTextCount(content, 'transfers');
  if (!Number.isFinite(holders) && !Number.isFinite(transfers)) throw new Error('BaseScan text mirror did not expose holder or transfer totals');
  return {
    holders,
    transfers,
    source: 'BaseScan token page via text mirror',
    sourceUrl: BASESCAN_TOKEN_URL
  };
}

async function fetchBaseScanLegacyTokenInfo(timeoutMs = EXPLORER_TIMEOUT_MS) {
  const apiKey = getExplorerApiKey();
  if (!apiKey) throw new Error('No valid BaseScan/Etherscan API key configured');
  const url = new URL('https://api.basescan.org/api');
  url.searchParams.set('module', 'token');
  url.searchParams.set('action', 'tokeninfo');
  url.searchParams.set('contractaddress', BASE_TOKEN);
  url.searchParams.set('apikey', apiKey);
  const data = await fetchJson(url.toString(), timeoutMs);
  if (data.status !== '1' || !Array.isArray(data.result) || !data.result.length) throw new Error(data.result || data.message || 'BaseScan tokeninfo failed');
  const info = data.result[0] || {};
  const holders = asNumber(info.holders ?? info.tokenHolders ?? info.token_holders ?? info.holderCount ?? info.holdersCount);
  const transfers = asNumber(info.transfers ?? info.tokenTransfers ?? info.transferCount ?? info.transfersCount);
  if (!Number.isFinite(holders) && !Number.isFinite(transfers)) throw new Error('BaseScan tokeninfo did not return holder/transfer totals');
  return { holders, transfers, source: 'BaseScan API tokeninfo', sourceUrl: BASESCAN_TOKEN_URL };
}

async function fetchBaseScanLegacyHolderListCount(timeoutMs = EXPLORER_TIMEOUT_MS * 2) {
  const apiKey = getExplorerApiKey();
  if (!apiKey) throw new Error('No valid BaseScan/Etherscan API key configured');
  const url = new URL('https://api.basescan.org/api');
  url.searchParams.set('module', 'token');
  url.searchParams.set('action', 'tokenholderlist');
  url.searchParams.set('contractaddress', BASE_TOKEN);
  url.searchParams.set('page', '1');
  url.searchParams.set('offset', '10000');
  url.searchParams.set('apikey', apiKey);
  const data = await fetchJson(url.toString(), timeoutMs);
  if (data.status !== '1' || !Array.isArray(data.result)) throw new Error(data.result || data.message || 'BaseScan tokenholderlist failed');
  return {
    holders: data.result.length,
    transfers: null,
    source: data.result.length >= 10000 ? 'BaseScan API tokenholderlist capped count' : 'BaseScan API tokenholderlist count',
    sourceUrl: BASESCAN_TOKEN_URL
  };
}

async function fetchBaseOfficialCounters() {
  const manualHolders = getManualNumber('BASESCAN_BASE_HOLDERS');
  const manualTransfers = getManualNumber('BASESCAN_BASE_TRANSFERS');
  if (Number.isFinite(manualHolders) || Number.isFinite(manualTransfers)) {
    return {
      holders: manualHolders,
      transfers: manualTransfers,
      source: 'Configured BaseScan official count override',
      sourceUrl: BASESCAN_TOKEN_URL
    };
  }

  const attempts = [
    () => fetchEtherscanHolderCount(chainConfigs.base),
    () => fetchBaseScanLegacyTokenInfo(),
    () => fetchBaseScanLegacyHolderListCount(),
    () => fetchBaseScanPageSummary()
  ];
  const errors = [];
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (Number.isFinite(result?.holders) || Number.isFinite(result?.transfers)) return result;
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  }
  throw new Error(`No BaseScan official-count source returned data: ${errors.join(' | ')}`);
}

async function fetchBaseScanHint() {
  // Kept for response-shape compatibility. Base official counts are now fetched inside fetchBaseOfficialCounters().
  return null;
}

async function fetchCounters(chain) {
  const data = await fetchJson(`${chain.blockscoutApi}/tokens/${chain.token}/counters`);
  return {
    holders: asNumber(data.token_holders_count ?? data.holders_count ?? data.holdersCount),
    transfers: asNumber(data.transfers_count ?? data.token_transfers_count ?? data.transfer_count),
    source: `${chain.label} Blockscout token counters`,
    sourceUrl: `${chain.blockscoutApi}/tokens/${chain.token}/counters`
  };
}

async function fetchTokenInfo(chain) {
  const data = await fetchJson(`${chain.blockscoutApi}/tokens/${chain.token}`);
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

function buildNextUrl(baseUrl, nextPage) {
  if (!nextPage || typeof nextPage !== 'object' || !Object.keys(nextPage).length) return null;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(nextPage)) {
    if (value !== null && value !== undefined) params.set(key, String(value));
  }
  return `${baseUrl}?${params.toString()}`;
}

async function fetchTokenTransfers(chain, pages = TRANSFER_PAGES) {
  const baseUrl = `${chain.blockscoutApi}/tokens/${chain.token}/transfers`;
  let url = baseUrl;
  const transfers = [];
  const seen = new Set();
  let nextPage = null;
  let pageCount = 0;

  while (url && pageCount < pages && transfers.length < TABLE_RECORD_LIMIT) {
    pageCount += 1;
    const data = await fetchJson(url);
    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      const transfer = normalizeBlockscoutTransfer(item, chain);
      if (!transfer) continue;
      const key = `${transfer.chainKey}:${transfer.transactionHash}:${transfer.logIndex || transfer.from}:${transfer.to}:${transfer.amountRaw}`;
      if (seen.has(key)) continue;
      seen.add(key);
      transfers.push(transfer);
      if (transfers.length >= TABLE_RECORD_LIMIT) break;
    }
    nextPage = data.next_page_params || null;
    url = buildNextUrl(baseUrl, nextPage);
  }

  return {
    transfers,
    visibleTransferCount: transfers.length,
    source: `${chain.label} Blockscout token transfers`,
    sourceUrl: baseUrl,
    capped: Boolean(nextPage)
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

async function settleWithTimeout(promise, ms, label) {
  try {
    const value = await Promise.race([promise, timeoutError(ms, label)]);
    return { status: 'fulfilled', value };
  } catch (reason) {
    return { status: 'rejected', reason };
  }
}

async function fetchChainBundle(chain) {
  const apiKeyConfigured = Boolean(getExplorerApiKey());
  const warnings = [];
  let counters = null;
  let token = null;
  let transferData = null;

  if (chain.key === 'base') {
    const officialCountersResult = await settleWithTimeout(fetchBaseOfficialCounters(), 14_000, 'BaseScan official holder/transfer totals');
    if (officialCountersResult.status === 'fulfilled') counters = officialCountersResult.value;
    else warnings.push(`BaseScan official counts unavailable: ${officialCountersResult.reason?.message || 'unknown error'}`);
  }

  if (apiKeyConfigured) {
    const [holderResult, transferCountResult, transfersResult, tokenResult] = await Promise.all([
      settleWithTimeout(fetchEtherscanHolderCount(chain), EXPLORER_TIMEOUT_MS, `${chain.label} Etherscan holder count`),
      settleWithTimeout(fetchEtherscanTokenTransferCount(chain), EXPLORER_TIMEOUT_MS * 3, `${chain.label} Etherscan all-time transfer count`),
      settleWithTimeout(fetchEtherscanTokenTransfers(chain), EXPLORER_TIMEOUT_MS * 2, `${chain.label} Etherscan latest token transfers`),
      settleWithTimeout(fetchTokenInfo(chain), FAST_TIMEOUT_MS, `${chain.label} token metadata`)
    ]);

    counters = mergeCounterResults([holderResult, transferCountResult], chain.transferExplorer) || counters;
    if (holderResult.status === 'rejected') warnings.push(`${chain.label} Etherscan holder count unavailable: ${holderResult.reason?.message || 'unknown error'}`);
    if (transferCountResult.status === 'rejected') warnings.push(`${chain.label} Etherscan all-time transfer count unavailable: ${transferCountResult.reason?.message || 'unknown error'}`);

    if (transfersResult.status === 'fulfilled') transferData = transfersResult.value;
    else warnings.push(`${chain.label} Etherscan latest token transfers unavailable: ${transfersResult.reason?.message || 'unknown error'}`);

    if (tokenResult.status === 'fulfilled') token = tokenResult.value;
    else warnings.push(`${chain.label} token metadata unavailable: ${tokenResult.reason?.message || 'unknown error'}`);
  }

  if (!counters || !transferData) {
    const [countersResult, tokenResult, transfersResult] = await Promise.all([
      !counters && chain.key !== 'base' ? settleWithTimeout(fetchCounters(chain), FAST_TIMEOUT_MS, `${chain.label} Blockscout counters`) : Promise.resolve(counters ? { status: 'fulfilled', value: counters } : { status: 'rejected', reason: new Error('Base Blockscout holder counters disabled to avoid BaseScan mismatch') }),
      !token ? settleWithTimeout(fetchTokenInfo(chain), FAST_TIMEOUT_MS, `${chain.label} token metadata`) : Promise.resolve({ status: 'fulfilled', value: token }),
      !transferData ? settleWithTimeout(fetchTokenTransfers(chain), FAST_TIMEOUT_MS * 2, `${chain.label} Blockscout transfer rows`) : Promise.resolve({ status: 'fulfilled', value: transferData })
    ]);

    if (!counters && countersResult.status === 'fulfilled') counters = countersResult.value;
    else if (!counters && countersResult.status === 'rejected') warnings.push(`${chain.label} Blockscout counters unavailable: ${countersResult.reason?.message || 'unknown error'}`);

    if (!token && tokenResult.status === 'fulfilled') token = tokenResult.value;
    else if (!token && tokenResult.status === 'rejected') warnings.push(`${chain.label} token metadata unavailable: ${tokenResult.reason?.message || 'unknown error'}`);

    if (!transferData && transfersResult.status === 'fulfilled') transferData = transfersResult.value;
    else if (!transferData && transfersResult.status === 'rejected') warnings.push(`${chain.label} Blockscout transfer rows unavailable: ${transfersResult.reason?.message || 'unknown error'}`);
  }

  const holders = Number.isFinite(counters?.holders)
    ? counters.holders
    : (Number.isFinite(token?.count) ? token.count : null);
  const visibleRows = Array.isArray(transferData?.transfers) ? transferData.transfers.length : 0;
  const transferCountCandidates = [transferData?.totalTransferCount, counters?.transfers, visibleRows].filter(Number.isFinite);
  const transferCount = transferCountCandidates.length ? Math.max(...transferCountCandidates) : 0;
  const transfers = Array.isArray(transferData?.transfers) ? transferData.transfers : [];

  return {
    holders,
    holderSource: counters ? counters.source : (token ? `${chain.label} Blockscout token metadata` : null),
    holderSourceUrl: counters?.sourceUrl || chain.holderExplorer,
    explorerUrl: chain.key === 'ethereum' ? ETHERSCAN_URL : BASESCAN_URL,
    transferExplorerUrl: chain.transferExplorer,
    token,
    transfers,
    transferCount,
    visibleTransferCount: transfers.length,
    transferSource: counters?.transferSource || transferData?.source || null,
    transferSourceUrl: counters?.transferSourceUrl || transferData?.sourceUrl || chain.transferExplorer,
    warnings
  };
}


async function fetchBaseOfficialCountersFast() {
  const manualHolders = getManualNumber('BASESCAN_BASE_HOLDERS');
  const manualTransfers = getManualNumber('BASESCAN_BASE_TRANSFERS');
  if (Number.isFinite(manualHolders) || Number.isFinite(manualTransfers)) {
    return {
      holders: manualHolders,
      transfers: manualTransfers,
      source: 'Configured BaseScan official count override',
      sourceUrl: BASESCAN_TOKEN_URL
    };
  }

  const attempts = [
    settleWithTimeout(fetchEtherscanHolderCount(chainConfigs.base), 5_500, 'Base Etherscan tokenholdercount'),
    settleWithTimeout(fetchEtherscanTokenTransferCount(chainConfigs.base), 12_000, 'Base Etherscan tokentx transfer count'),
    settleWithTimeout(fetchBaseScanLegacyTokenInfo(5_500), 5_500, 'BaseScan tokeninfo'),
    settleWithTimeout(fetchBaseScanLegacyHolderListCount(7_500), 7_500, 'BaseScan tokenholderlist'),
    settleWithTimeout(fetchBaseScanPageSummary(10_000), 10_000, 'BaseScan token page text mirror')
  ];
  const results = await Promise.all(attempts);
  const merged = mergeCounterResults(results, BASESCAN_TOKEN_URL);
  if (merged) return merged;

  const errors = results
    .filter(result => result.status === 'rejected')
    .map(result => result.reason?.message || String(result.reason));
  throw new Error(`Base official counts unavailable: ${errors.join(' | ')}`);
}

async function fetchBaseTransfersFast() {
  const attempts = [];
  if (getExplorerApiKey()) {
    attempts.push(settleWithTimeout(fetchEtherscanTokenTransfers(chainConfigs.base), 7_500, 'Base Etherscan tokentx'));
  }
  attempts.push(settleWithTimeout(fetchTokenTransfers(chainConfigs.base, 2), 5_500, 'Base public transfer rows'));

  const results = await Promise.all(attempts);
  const etherscanResult = results.find(result =>
    result.status === 'fulfilled' &&
    result.value &&
    String(result.value.source || '').toLowerCase().includes('etherscan') &&
    (Array.isArray(result.value.transfers) || Number.isFinite(result.value.totalTransferCount))
  );
  if (etherscanResult) return etherscanResult.value;

  const anyTransferResult = results.find(result =>
    result.status === 'fulfilled' &&
    result.value &&
    Array.isArray(result.value.transfers)
  );
  if (anyTransferResult) return anyTransferResult.value;

  const errors = results
    .filter(result => result.status === 'rejected')
    .map(result => result.reason?.message || String(result.reason));
  throw new Error(`Base transfer feed unavailable: ${errors.join(' | ')}`);
}

async function fetchBaseIndependentBundle() {
  const warnings = [];
  const [countersResult, transfersResult, tokenResult] = await Promise.all([
    settleWithTimeout(fetchBaseOfficialCountersFast(), 8_500, 'Base official counts'),
    settleWithTimeout(fetchBaseTransfersFast(), 8_500, 'Base token transfers'),
    settleWithTimeout(fetchTokenInfo(chainConfigs.base), 4_500, 'Base token metadata')
  ]);

  const counters = countersResult.status === 'fulfilled' ? countersResult.value : null;
  const transferData = transfersResult.status === 'fulfilled' ? transfersResult.value : null;
  const token = tokenResult.status === 'fulfilled' ? tokenResult.value : null;

  if (countersResult.status === 'rejected') warnings.push(`Base official counts unavailable: ${countersResult.reason?.message || 'unknown error'}`);
  if (transfersResult.status === 'rejected') warnings.push(`Base token transfers unavailable: ${transfersResult.reason?.message || 'unknown error'}`);
  if (tokenResult.status === 'rejected') warnings.push(`Base token metadata unavailable: ${tokenResult.reason?.message || 'unknown error'}`);

  const transfers = Array.isArray(transferData?.transfers) ? transferData.transfers : [];
  const baseTransferCountCandidates = [transferData?.totalTransferCount, counters?.transfers, transfers.length].filter(Number.isFinite);
  const transferCount = baseTransferCountCandidates.length ? Math.max(...baseTransferCountCandidates) : 0;

  return {
    holders: Number.isFinite(counters?.holders) ? counters.holders : null,
    holderSource: counters?.source || null,
    holderSourceUrl: counters?.sourceUrl || BASESCAN_TOKEN_URL,
    explorerUrl: BASESCAN_URL,
    transferExplorerUrl: BASESCAN_URL,
    token,
    transfers,
    transferCount,
    visibleTransferCount: transfers.length,
    transferSource: counters?.transferSource || transferData?.source || (Number.isFinite(counters?.transfers) ? counters.source : null),
    transferSourceUrl: counters?.transferSourceUrl || transferData?.sourceUrl || counters?.sourceUrl || BASESCAN_URL,
    warnings
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestUrl = new URL(req.url || '/', 'https://chili-coin.local');
  const force = requestUrl.searchParams.get('force') === '1';
  // Let Vercel cache automatic polls. Manual refresh still bypasses cache.
  res.setHeader('Cache-Control', force ? 'no-store, max-age=0' : 's-maxage=20, stale-while-revalidate=120');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const fetchedAt = new Date().toISOString();
  const [ethereumResult, baseResult, baseScanHintResult] = await Promise.all([
    settleWithTimeout(fetchChainBundle(chainConfigs.ethereum), FAST_TIMEOUT_MS * 2, 'Ethereum bundle'),
    settleWithTimeout(fetchBaseIndependentBundle(), 9_000, 'Base independent bundle'),
    settleWithTimeout(fetchBaseScanHint(), BASESCAN_HINT_TIMEOUT_MS, 'BaseScan optional hint')
  ]);

  const warnings = [];
  const rawExplorerKey = String(process.env.ETHERSCAN_API_KEY || process.env.BASESCAN_API_KEY || '').trim();
  if (rawExplorerKey && /^sk_live/i.test(rawExplorerKey)) warnings.push('A value is present for ETHERSCAN_API_KEY/BASESCAN_API_KEY, but it looks like a non-Etherscan secret key. The tracker ignored it and used fallback data.');
  if (!rawExplorerKey) warnings.push('No ETHERSCAN_API_KEY is visible to this deployment. Base holder count uses BaseScan public page text if available; Blockscout holder counters are not used for the visible Base total.');
  if (ethereumResult.status === 'rejected') warnings.push(`Ethereum bundle unavailable: ${ethereumResult.reason?.message || 'unknown error'}`);
  if (baseResult.status === 'rejected') warnings.push(`Base bundle unavailable: ${baseResult.reason?.message || 'unknown error'}`);
  if (baseScanHintResult.status === 'rejected') warnings.push(`BaseScan optional hint skipped: ${baseScanHintResult.reason?.message || 'unknown error'}`);

  const ethereum = ethereumResult.status === 'fulfilled' ? ethereumResult.value : {
    holders: null, holderSource: null, holderSourceUrl: chainConfigs.ethereum.holderExplorer, explorerUrl: ETHERSCAN_URL,
    transferExplorerUrl: ETHERSCAN_TX_URL, token: null, transfers: [], transferCount: 0, visibleTransferCount: 0, transferSource: null, transferSourceUrl: ETHERSCAN_TX_URL, warnings: []
  };
  const base = baseResult.status === 'fulfilled' ? baseResult.value : {
    holders: null, holderSource: null, holderSourceUrl: BASESCAN_URL, explorerUrl: BASESCAN_URL,
    transferExplorerUrl: BASESCAN_URL, token: null, transfers: [], transferCount: 0, visibleTransferCount: 0, transferSource: null, transferSourceUrl: BASESCAN_URL, warnings: []
  };

  warnings.push(...(ethereum.warnings || []), ...(base.warnings || []));
  if (!base.transferSource) warnings.push('Base transfer feed did not return rows this refresh; keeping BaseScan link available for official review.');

  const baseHint = baseScanHintResult.status === 'fulfilled' ? baseScanHintResult.value : null;
  if (baseHint) {
    const hintedHolders = parseBaseScanTextCount(baseHint.content || '', 'holders');
    const hintedTransfers = parseBaseScanTextCount(baseHint.content || '', 'transfers');
    if (Number.isFinite(hintedHolders)) {
      base.holders = hintedHolders;
      base.holderSource = 'BaseScan public token page hint';
      base.holderSourceUrl = BASESCAN_TOKEN_URL;
    }
    if (Number.isFinite(hintedTransfers)) {
      base.transferCount = hintedTransfers;
      base.transferSource = `${base.transferSource || 'Base public indexer'} + BaseScan public token page hint`;
      base.transferSourceUrl = BASESCAN_URL;
    }
  }

  const chainTotal = Number.isFinite(ethereum.holders) && Number.isFinite(base.holders)
    ? ethereum.holders + base.holders
    : null;
  const allTransfers = [...(ethereum.transfers || []), ...(base.transfers || [])]
    .sort(sortTransfers)
    .slice(0, TABLE_RECORD_LIMIT);
  const allTransferTotal = (Number(ethereum.transferCount) || 0) + (Number(base.transferCount) || 0);

  return res.status(200).json({
    ok: Boolean(ethereum.holders !== null || base.holders !== null || allTransfers.length),
    fetchedAt,
    refreshSeconds: 20,
    contracts: {
      ethereumToken: ETH_TOKEN,
      baseToken: BASE_TOKEN
    },
    dataMode: {
      mode: 'v17-official-txn-count',
      explorerApiKeyConfigured: Boolean(process.env.ETHERSCAN_API_KEY || process.env.BASESCAN_API_KEY),
      note: getExplorerApiKey() ? 'Etherscan/BaseScan API is configured. Holder totals, all-time TXN totals, and latest TXN rows load separately. TXN card uses all-time transfer counts, not latest-row count.' : 'No valid ETHERSCAN_API_KEY detected. Base counts and Base transfers load separately; BaseScan link remains the official review source.'
    },
    ethereum,
    base,
    transactions: {
      totalCount: allTransferTotal,
      latestCount: allTransfers.length,
      ethereumTotalCount: ethereum.transferCount || 0,
      baseTotalCount: base.transferCount || 0,
      ethereumLatestCount: ethereum.transfers?.length || 0,
      baseLatestCount: base.transfers?.length || 0,
      label: 'All Chain Transactions',
      note: 'TXN counts public indexed ERC-20 Transfer events. Source Wallet is the CHI From wallet, Recipient is the CHI To wallet, and Amount is decoded from the token transfer event value.',
      records: allTransfers,
      sources: [ethereum.transferSource, base.transferSource, ethereum.holderSource, base.holderSource].filter(Boolean),
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
