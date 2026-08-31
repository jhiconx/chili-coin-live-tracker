const ETH_TOKEN = '0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA';
const BASE_TOKEN = '0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const CHAINS = {
  ethereum: {
    key: 'ethereum',
    label: 'Ethereum',
    chainid: '1',
    token: ETH_TOKEN,
    tokenUrl: `https://etherscan.io/token/${ETH_TOKEN}`,
    transferUrl: `https://etherscan.io/token/${ETH_TOKEN}#tokentxns`,
    txExplorer: 'https://etherscan.io/tx',
    addressExplorer: 'https://etherscan.io/address',
    blockscoutApi: 'https://eth.blockscout.com/api/v2'
  },
  base: {
    key: 'base',
    label: 'Base',
    chainid: '8453',
    token: BASE_TOKEN,
    tokenUrl: `https://basescan.org/token/${BASE_TOKEN}`,
    transferUrl: `https://basescan.org/token/${BASE_TOKEN}#transactions`,
    txExplorer: 'https://basescan.org/tx',
    addressExplorer: 'https://basescan.org/address',
    blockscoutApi: 'https://base.blockscout.com/api/v2'
  }
};

const TABLE_RECORD_LIMIT = 300;
const PAGE_OFFSET = 1000;
const MAX_PAGES = 20;
const API_TIMEOUT_MS = 12000;
const BLOCKSCOUT_TIMEOUT_MS = 6500;

function getExplorerApiKey() {
  const raw = String(process.env.ETHERSCAN_API_KEY || process.env.BASESCAN_API_KEY || '').trim();
  if (!raw || /^sk_live/i.test(raw)) return null;
  return raw;
}

function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function timeout(ms, label) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms));
}

async function withTimeout(promise, ms, label) {
  return Promise.race([promise, timeout(ms, label)]);
}

async function fetchWithTimeout(url, timeoutMs, accept = 'application/json, text/plain, */*') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        accept,
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        'user-agent': 'Mozilla/5.0 (compatible; ChiliCoinLiveTracker/22.0)'
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs = API_TIMEOUT_MS) {
  const response = await fetchWithTimeout(url, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function etherscanV2(params, timeoutMs = API_TIMEOUT_MS) {
  const apiKey = getExplorerApiKey();
  if (!apiKey) throw new Error('ETHERSCAN_API_KEY missing');
  const url = new URL('https://api.etherscan.io/v2/api');
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  url.searchParams.set('apikey', apiKey);
  const data = await fetchJson(url.toString(), timeoutMs);
  if (data.status === '1' && Array.isArray(data.result)) return data.result;
  if (data.status === '1') return data.result;
  const message = String(data.result || data.message || 'Etherscan API NOTOK');
  if (/no transactions found|no records found/i.test(message)) return [];
  throw new Error(message);
}

async function legacyExplorerApi(base, params, timeoutMs = API_TIMEOUT_MS) {
  const apiKey = getExplorerApiKey();
  if (!apiKey) throw new Error('ETHERSCAN_API_KEY missing');
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  url.searchParams.set('apikey', apiKey);
  const data = await fetchJson(url.toString(), timeoutMs);
  if (data.status === '1' && Array.isArray(data.result)) return data.result;
  if (data.status === '1') return data.result;
  const message = String(data.result || data.message || 'Explorer API NOTOK');
  if (/no transactions found|no records found/i.test(message)) return [];
  throw new Error(message);
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

function normalizeAddress(value) {
  const text = String(value || '').toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(text) ? text : '';
}

function normalizeTokenTx(item, chain, sourceName) {
  const tx = String(item.hash || item.transactionHash || '').toLowerCase();
  const from = normalizeAddress(item.from);
  const to = normalizeAddress(item.to);
  if (!tx || !from || !to) return null;
  const contract = String(item.contractAddress || item.contractaddress || chain.token).toLowerCase();
  if (contract && contract !== chain.token.toLowerCase()) return null;
  const decimals = asNumber(item.tokenDecimal ?? item.tokenDecimals ?? item.decimals) ?? 18;
  const timestamp = item.timeStamp ? new Date(Number(item.timeStamp) * 1000).toISOString() : null;
  let event = 'Transfer';
  if (from === ZERO_ADDRESS) event = 'Mint';
  else if (to === ZERO_ADDRESS) event = 'Burn';
  return {
    chain: chain.label,
    chainKey: chain.key,
    transactionHash: tx,
    transactionUrl: `${chain.txExplorer}/${tx}`,
    blockNumber: String(item.blockNumber || ''),
    timestamp,
    from,
    to,
    fromUrl: `${chain.addressExplorer}/${from}`,
    toUrl: `${chain.addressExplorer}/${to}`,
    event,
    amount: decimalAmount(item.value, decimals),
    amountRaw: String(item.value ?? '0'),
    decimals,
    tokenSymbol: item.tokenSymbol || 'CHI',
    sourceWallet: from,
    sourceWalletUrl: `${chain.addressExplorer}/${from}`,
    transactionInitiator: null,
    calledContract: chain.token.toLowerCase(),
    methodId: item.methodId || null,
    functionName: item.functionName || null,
    logIndex: String(item.logIndex ?? item.transactionIndex ?? item.nonce ?? ''),
    sourceKind: 'erc20-transfer-event',
    sourceName
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

function dedupeTransfers(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows.filter(Boolean)) {
    const key = `${row.chainKey}:${row.transactionHash}:${row.logIndex}:${row.from}:${row.to}:${row.amountRaw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

async function fetchEtherscanTokenTransferPage(chain, page, sort = 'asc') {
  const result = await etherscanV2({
    chainid: chain.chainid,
    module: 'account',
    action: 'tokentx',
    contractaddress: chain.token,
    page,
    offset: PAGE_OFFSET,
    sort
  }, API_TIMEOUT_MS);
  return Array.isArray(result) ? result : [];
}

async function fetchLegacyBaseScanTokenTransferPage(page, sort = 'asc') {
  const result = await legacyExplorerApi('https://api.basescan.org/api', {
    module: 'account',
    action: 'tokentx',
    contractaddress: BASE_TOKEN,
    page,
    offset: PAGE_OFFSET,
    sort
  }, API_TIMEOUT_MS);
  return Array.isArray(result) ? result : [];
}

async function fetchAllTokenTransfersViaEtherscan(chain) {
  const raw = [];
  let pagesFetched = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const pageRows = await fetchEtherscanTokenTransferPage(chain, page, 'asc');
    pagesFetched = page;
    raw.push(...pageRows);
    if (pageRows.length < PAGE_OFFSET) break;
  }
  const rows = dedupeTransfers(raw.map(item => normalizeTokenTx(item, chain, `${chain.label} Etherscan V2 full token transfer history`)));
  return { rows, source: `${chain.label} Etherscan V2 full token transfer history`, pagesFetched, rawRows: raw.length };
}

async function fetchAllBaseTransfersViaLegacyBaseScan() {
  const raw = [];
  let pagesFetched = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const pageRows = await fetchLegacyBaseScanTokenTransferPage(page, 'asc');
    pagesFetched = page;
    raw.push(...pageRows);
    if (pageRows.length < PAGE_OFFSET) break;
  }
  const rows = dedupeTransfers(raw.map(item => normalizeTokenTx(item, CHAINS.base, 'BaseScan legacy full token transfer history')));
  return { rows, source: 'BaseScan legacy full token transfer history', pagesFetched, rawRows: raw.length };
}

function computeHolderCountFromTransfers(rows) {
  const balances = new Map();
  for (const row of rows) {
    const amount = /^[0-9]+$/.test(String(row.amountRaw || '')) ? BigInt(row.amountRaw) : 0n;
    if (amount === 0n) continue;
    const from = normalizeAddress(row.from);
    const to = normalizeAddress(row.to);
    if (from && from !== ZERO_ADDRESS) balances.set(from, (balances.get(from) || 0n) - amount);
    if (to && to !== ZERO_ADDRESS) balances.set(to, (balances.get(to) || 0n) + amount);
  }
  let holders = 0;
  for (const value of balances.values()) {
    if (value > 0n) holders += 1;
  }
  return holders || null;
}

async function fetchBlockscoutCounters(chain) {
  const data = await fetchJson(`${chain.blockscoutApi}/tokens/${chain.token}/counters`, BLOCKSCOUT_TIMEOUT_MS);
  return {
    holders: asNumber(data.token_holders_count ?? data.holders_count ?? data.holdersCount),
    transfers: asNumber(data.transfers_count ?? data.token_transfers_count ?? data.transfer_count),
    source: `${chain.label} Blockscout token counters`,
    sourceUrl: `${chain.blockscoutApi}/tokens/${chain.token}/counters`
  };
}

async function fetchTokenInfo(chain) {
  const data = await fetchJson(`${chain.blockscoutApi}/tokens/${chain.token}`, BLOCKSCOUT_TIMEOUT_MS);
  return {
    count: asNumber(data.holders_count ?? data.holdersCount ?? data.holder_count),
    name: data.name || null,
    symbol: data.symbol || null,
    type: data.type || null,
    decimals: asNumber(data.decimals) ?? 18
  };
}

async function fetchEthereumChain() {
  const warnings = [];
  let all = { rows: [], source: null, pagesFetched: 0, rawRows: 0 };
  try {
    all = await withTimeout(fetchAllTokenTransfersViaEtherscan(CHAINS.ethereum), 18000, 'Ethereum full transfer history');
  } catch (error) {
    warnings.push(`Ethereum transfer history unavailable: ${error.message || String(error)}`);
  }

  let counters = { holders: null, transfers: null, source: null, sourceUrl: CHAINS.ethereum.tokenUrl };
  try {
    counters = await fetchBlockscoutCounters(CHAINS.ethereum);
  } catch (error) {
    warnings.push(`Ethereum holder counter skipped: ${error.message || String(error)}`);
  }

  let token = null;
  try {
    token = await fetchTokenInfo(CHAINS.ethereum);
  } catch (error) {
    warnings.push(`Ethereum token metadata skipped: ${error.message || String(error)}`);
  }

  const holders = Number.isFinite(counters.holders) ? counters.holders : (Number.isFinite(token?.count) ? token.count : null);
  const transferCount = all.rows.length || (Number.isFinite(counters.transfers) ? counters.transfers : null);
  const latest = [...all.rows].sort(sortTransfers).slice(0, TABLE_RECORD_LIMIT);

  return {
    holders,
    holderSource: Number.isFinite(holders) ? (counters.source || 'Ethereum token metadata') : null,
    holderSourceUrl: counters.sourceUrl || CHAINS.ethereum.tokenUrl,
    explorerUrl: CHAINS.ethereum.transferUrl,
    transferExplorerUrl: CHAINS.ethereum.transferUrl,
    token,
    transfers: latest,
    transferCount,
    visibleTransferCount: latest.length,
    transferSource: all.source || counters.source || null,
    transferSourceUrl: CHAINS.ethereum.transferUrl,
    warnings,
    debug: { pagesFetched: all.pagesFetched, rawRows: all.rawRows, normalizedRows: all.rows.length }
  };
}

async function fetchBaseChainFromScratch() {
  const warnings = [];
  let all = null;

  try {
    all = await withTimeout(fetchAllTokenTransfersViaEtherscan(CHAINS.base), 22000, 'Base Etherscan V2 full transfer history');
  } catch (error) {
    warnings.push(`Base Etherscan V2 transfer history skipped: ${error.message || String(error)}`);
  }

  if (!all || !all.rows.length) {
    try {
      all = await withTimeout(fetchAllBaseTransfersViaLegacyBaseScan(), 22000, 'BaseScan legacy full transfer history');
    } catch (error) {
      warnings.push(`BaseScan legacy transfer history skipped: ${error.message || String(error)}`);
    }
  }

  if (!all || !all.rows.length) {
    return {
      holders: null,
      holderSource: null,
      holderSourceUrl: CHAINS.base.tokenUrl,
      explorerUrl: CHAINS.base.transferUrl,
      transferExplorerUrl: CHAINS.base.transferUrl,
      token: null,
      transfers: [],
      transferCount: null,
      visibleTransferCount: 0,
      transferSource: null,
      transferSourceUrl: CHAINS.base.transferUrl,
      warnings: [...warnings, 'Base transfer history returned no rows; leaving Base blank instead of showing wrong fallback values.'],
      debug: { pagesFetched: 0, rawRows: 0, normalizedRows: 0, computedHolders: null }
    };
  }

  const holders = computeHolderCountFromTransfers(all.rows);
  const latest = [...all.rows].sort(sortTransfers).slice(0, TABLE_RECORD_LIMIT);

  return {
    holders,
    holderSource: holders ? 'BaseScan transfer history computed holder count' : null,
    holderSourceUrl: CHAINS.base.transferUrl,
    explorerUrl: CHAINS.base.transferUrl,
    transferExplorerUrl: CHAINS.base.transferUrl,
    token: { count: holders, name: 'ChiliCoin', symbol: 'CHI', type: 'ERC-20', decimals: 18 },
    transfers: latest,
    transferCount: all.rows.length,
    visibleTransferCount: latest.length,
    transferSource: all.source,
    transferSourceUrl: CHAINS.base.transferUrl,
    warnings,
    debug: { pagesFetched: all.pagesFetched, rawRows: all.rawRows, normalizedRows: all.rows.length, computedHolders: holders }
  };
}

function emptyChain(chain) {
  return {
    holders: null,
    holderSource: null,
    holderSourceUrl: chain.tokenUrl,
    explorerUrl: chain.transferUrl,
    transferExplorerUrl: chain.transferUrl,
    token: null,
    transfers: [],
    transferCount: null,
    visibleTransferCount: 0,
    transferSource: null,
    transferSourceUrl: chain.transferUrl,
    warnings: [],
    debug: {}
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestUrl = new URL(req.url || '/', 'https://chili-coin.local');
  const force = requestUrl.searchParams.get('force') === '1';
  res.setHeader('Cache-Control', force ? 'no-store, max-age=0' : 's-maxage=20, stale-while-revalidate=120');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const warnings = [];
  const rawKey = String(process.env.ETHERSCAN_API_KEY || process.env.BASESCAN_API_KEY || '').trim();
  if (!rawKey) warnings.push('No ETHERSCAN_API_KEY or BASESCAN_API_KEY visible to this deployment.');
  if (/^sk_live/i.test(rawKey)) warnings.push('Configured API key looks like a non-Etherscan key and was ignored.');

  const [ethResult, baseResult] = await Promise.allSettled([
    withTimeout(fetchEthereumChain(), 24000, 'Ethereum chain load'),
    withTimeout(fetchBaseChainFromScratch(), 26000, 'Base full transfer-history rebuild')
  ]);

  const ethereum = ethResult.status === 'fulfilled' ? ethResult.value : emptyChain(CHAINS.ethereum);
  const base = baseResult.status === 'fulfilled' ? baseResult.value : emptyChain(CHAINS.base);

  if (ethResult.status === 'rejected') warnings.push(`Ethereum unavailable: ${ethResult.reason?.message || String(ethResult.reason)}`);
  if (baseResult.status === 'rejected') warnings.push(`Base unavailable: ${baseResult.reason?.message || String(baseResult.reason)}`);
  warnings.push(...(ethereum.warnings || []), ...(base.warnings || []));

  const chainTotal = Number.isFinite(ethereum.holders) && Number.isFinite(base.holders) ? ethereum.holders + base.holders : null;
  const records = dedupeTransfers([...(base.transfers || []), ...(ethereum.transfers || [])]).sort(sortTransfers).slice(0, TABLE_RECORD_LIMIT);

  const ethTx = Number.isFinite(ethereum.transferCount) ? ethereum.transferCount : null;
  const baseTx = Number.isFinite(base.transferCount) ? base.transferCount : null;
  const totalCount = Number.isFinite(ethTx) && Number.isFinite(baseTx) ? ethTx + baseTx : null;

  return res.status(200).json({
    ok: Boolean(Number.isFinite(ethereum.holders) || Number.isFinite(base.holders) || records.length),
    fetchedAt: new Date().toISOString(),
    refreshSeconds: 20,
    contracts: { ethereumToken: ETH_TOKEN, baseToken: BASE_TOKEN },
    dataMode: {
      mode: 'v22-base-rebuilt-from-transfer-history',
      explorerApiKeyConfigured: Boolean(getExplorerApiKey()),
      note: 'Base was rebuilt from full Base CHI ERC-20 Transfer history. Holder count is computed from balances; TXN count is counted from transfer events. No BaseScan page scraping and no Blockscout Base holder counters.'
    },
    ethereum,
    base,
    transactions: {
      totalCount,
      latestCount: records.length,
      ethereumTotalCount: ethTx,
      baseTotalCount: baseTx,
      ethereumLatestCount: ethereum.transfers?.length || 0,
      baseLatestCount: base.transfers?.length || 0,
      label: Number.isFinite(totalCount) ? 'All Chain Transactions' : 'Pending All-Chain TXN Count',
      note: 'Base TXN and holder totals are computed from the full Base CHI Transfer event history returned by the explorer token-transfer API.',
      records,
      sources: [ethereum.transferSource, base.transferSource, ethereum.holderSource, base.holderSource].filter(Boolean),
      explorerLinks: { ethereum: CHAINS.ethereum.transferUrl, base: CHAINS.base.transferUrl }
    },
    chainTotal,
    chainTotalNote: 'Sum of chain holder totals; it is not deduplicated across chains.',
    warnings
  });
}
