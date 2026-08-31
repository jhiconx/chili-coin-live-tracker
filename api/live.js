const ETH_TOKEN = '0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA';
const BASE_TOKEN = '0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const ETHERSCAN_TOKEN_URL = `https://etherscan.io/token/${ETH_TOKEN}`;
const ETHERSCAN_TX_URL = `https://etherscan.io/token/${ETH_TOKEN}#transactions`;
const BASESCAN_TOKEN_URL = `https://basescan.org/token/${BASE_TOKEN}`;
const BASESCAN_TX_URL = `https://basescan.org/token/${BASE_TOKEN}#transactions`;

const TIMEOUT_MS = 14000;
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const TABLE_LIMIT = 300;
const SERVER_CACHE_MS = 18_000;

let memoryCache = null;

function getExplorerApiKey() {
  const raw = String(process.env.ETHERSCAN_API_KEY || process.env.BASESCAN_API_KEY || '').trim();
  if (!raw || /^sk_live/i.test(raw)) return null;
  return raw;
}

function normalizeAddress(value) {
  const text = String(value || '').trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(text) ? text : '';
}

function toNumber(value) {
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

async function fetchJson(url, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json,text/plain,*/*',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        'user-agent': 'ChiliCoinLiveTracker/24'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function etherscanV2TokenTx({ chainid, contractaddress, page, offset, sort }) {
  const apiKey = getExplorerApiKey();
  if (!apiKey) throw new Error('ETHERSCAN_API_KEY is missing in Vercel');

  const url = new URL('https://api.etherscan.io/v2/api');
  url.searchParams.set('chainid', String(chainid));
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'tokentx');
  url.searchParams.set('contractaddress', contractaddress);
  url.searchParams.set('page', String(page));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('sort', sort || 'asc');
  url.searchParams.set('apikey', apiKey);

  const data = await fetchJson(url.toString(), TIMEOUT_MS);
  if (data.status === '1' && Array.isArray(data.result)) return data.result;

  const message = String(data.result || data.message || 'Etherscan API NOTOK');
  if (/no transactions found|no records found/i.test(message)) return [];
  throw new Error(message);
}

function decimalAmount(rawValue, rawDecimals) {
  const value = String(rawValue ?? '0').trim();
  const decimals = Number(rawDecimals ?? 18);
  if (!/^[0-9]+$/.test(value) || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) return value || '0';
  const padded = value.padStart(decimals + 1, '0');
  const whole = decimals === 0 ? padded : padded.slice(0, -decimals);
  const fraction = decimals === 0 ? '' : padded.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function normalizeTokenTx(item, chain) {
  const tx = String(item.hash || item.transactionHash || '').trim().toLowerCase();
  const from = normalizeAddress(item.from);
  const to = normalizeAddress(item.to);
  if (!tx || !from || !to) return null;

  const contract = String(item.contractAddress || item.contractaddress || chain.token).trim().toLowerCase();
  if (contract && contract !== chain.token.toLowerCase()) return null;

  const decimals = toNumber(item.tokenDecimal ?? item.tokenDecimals ?? item.decimals) ?? 18;
  const timestamp = item.timeStamp ? new Date(Number(item.timeStamp) * 1000).toISOString() : (item.timestamp || null);
  let event = 'Transfer';
  if (from === ZERO_ADDRESS) event = 'Mint';
  else if (to === ZERO_ADDRESS) event = 'Burn';

  return {
    chain: chain.label,
    chainKey: chain.key,
    transactionHash: tx,
    transactionUrl: `${chain.txExplorer}/${tx}`,
    blockNumber: String(item.blockNumber || item.block_number || ''),
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
    sourceName: chain.sourceName
  };
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

function sortTransfers(a, b) {
  const ta = a.timestamp ? Date.parse(a.timestamp) : 0;
  const tb = b.timestamp ? Date.parse(b.timestamp) : 0;
  if (ta !== tb) return tb - ta;
  const ba = Number(a.blockNumber || 0);
  const bb = Number(b.blockNumber || 0);
  if (ba !== bb) return bb - ba;
  return Number(b.logIndex || 0) - Number(a.logIndex || 0);
}

async function fetchAllTokenTransfers(chain) {
  const raw = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const rows = await etherscanV2TokenTx({
      chainid: chain.chainid,
      contractaddress: chain.token,
      page,
      offset: PAGE_SIZE,
      sort: 'asc'
    });
    raw.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  const transfers = dedupeTransfers(raw.map(row => normalizeTokenTx(row, chain))).sort(sortTransfers);
  const balances = new Map();
  const add = (address, delta) => {
    if (!address || address === ZERO_ADDRESS) return;
    balances.set(address, (balances.get(address) || 0n) + delta);
  };

  for (const row of transfers) {
    const amount = /^[0-9]+$/.test(row.amountRaw) ? BigInt(row.amountRaw) : 0n;
    add(row.from, -amount);
    add(row.to, amount);
  }

  let holderCount = 0;
  for (const balance of balances.values()) {
    if (balance > 0n) holderCount += 1;
  }

  return {
    holderCount,
    transferCount: transfers.length,
    transfers,
    source: `${chain.explorerName} ERC-20 Transfer history`,
    sourceUrl: chain.transferExplorerUrl
  };
}

async function fetchChain(chain) {
  return withTimeout(fetchAllTokenTransfers(chain), TIMEOUT_MS * 2, `${chain.label} full transfer history`);
}

const ETH_CHAIN = {
  key: 'ethereum',
  label: 'Ethereum',
  chainid: '1',
  token: ETH_TOKEN,
  explorerName: 'Etherscan',
  tokenExplorerUrl: ETHERSCAN_TOKEN_URL,
  transferExplorerUrl: ETHERSCAN_TX_URL,
  txExplorer: 'https://etherscan.io/tx',
  addressExplorer: 'https://etherscan.io/address',
  sourceName: 'Ethereum Etherscan ERC-20 transfers'
};

const BASE_CHAIN = {
  key: 'base',
  label: 'Base',
  chainid: '8453',
  token: BASE_TOKEN,
  explorerName: 'BaseScan',
  tokenExplorerUrl: BASESCAN_TOKEN_URL,
  transferExplorerUrl: BASESCAN_TX_URL,
  txExplorer: 'https://basescan.org/tx',
  addressExplorer: 'https://basescan.org/address',
  sourceName: 'BaseScan ERC-20 transfers'
};

function buildEmptyChain(chain, error) {
  return {
    holders: null,
    holderSource: null,
    holderSourceUrl: chain.tokenExplorerUrl,
    explorerUrl: chain.tokenExplorerUrl,
    transferExplorerUrl: chain.transferExplorerUrl,
    token: { name: 'ChiliCoin', symbol: 'CHI', type: 'ERC-20', decimals: 18 },
    transfers: [],
    transferCount: null,
    transferSource: null,
    transferSourceUrl: chain.transferExplorerUrl,
    error: error ? String(error.message || error) : null
  };
}

export async function buildLivePayload({ force = false } = {}) {
  const now = Date.now();
  if (!force && memoryCache && now - memoryCache.cachedAt < SERVER_CACHE_MS) return memoryCache.payload;

  const fetchedAt = new Date().toISOString();
  const [ethResult, baseResult] = await Promise.allSettled([
    fetchChain(ETH_CHAIN),
    fetchChain(BASE_CHAIN)
  ]);

  const warnings = [];
  const ethData = ethResult.status === 'fulfilled' ? ethResult.value : null;
  const baseData = baseResult.status === 'fulfilled' ? baseResult.value : null;

  if (!ethData) warnings.push(`Ethereum transfer history unavailable: ${ethResult.reason?.message || 'unknown'}`);
  if (!baseData) warnings.push(`Base transfer history unavailable: ${baseResult.reason?.message || 'unknown'}`);

  const ethHolders = ethData?.holderCount ?? null;
  const baseHolders = baseData?.holderCount ?? null;
  const ethTxn = ethData?.transferCount ?? null;
  const baseTxn = baseData?.transferCount ?? null;

  const chainHolderTotal = Number.isFinite(ethHolders) && Number.isFinite(baseHolders) ? ethHolders + baseHolders : null;
  const allChainTransactions = Number.isFinite(ethTxn) && Number.isFinite(baseTxn) ? ethTxn + baseTxn : null;
  const allRows = dedupeTransfers([...(baseData?.transfers || []), ...(ethData?.transfers || [])]).sort(sortTransfers).slice(0, TABLE_LIMIT);

  const payload = {
    ok: Boolean(ethData || baseData),
    fetchedAt,
    refreshSeconds: 20,
    dataMode: {
      mode: 'v24-simple-txn-sum',
      design: 'TXN equals BaseScan ERC-20 transfer count plus Etherscan ERC-20 transfer count. Holder counts are computed from the same full Transfer histories.',
      explorerApiKeyConfigured: Boolean(getExplorerApiKey())
    },
    contracts: { ethereumToken: ETH_TOKEN, baseToken: BASE_TOKEN },
    ethereum: ethData ? {
      holders: ethHolders,
      holderSource: 'Computed from full Etherscan Transfer history',
      holderSourceUrl: ETHERSCAN_TX_URL,
      explorerUrl: ETHERSCAN_TOKEN_URL,
      transferExplorerUrl: ETHERSCAN_TX_URL,
      token: { name: 'ChiliCoin', symbol: 'CHI', type: 'ERC-20', decimals: 18 },
      transfers: ethData.transfers.slice(0, TABLE_LIMIT),
      transferCount: ethTxn,
      transferSource: ethData.source,
      transferSourceUrl: ethData.sourceUrl
    } : buildEmptyChain(ETH_CHAIN, ethResult.reason),
    base: baseData ? {
      holders: baseHolders,
      holderSource: 'Computed from full BaseScan Transfer history',
      holderSourceUrl: BASESCAN_TX_URL,
      explorerUrl: BASESCAN_TOKEN_URL,
      transferExplorerUrl: BASESCAN_TX_URL,
      token: { name: 'ChiliCoin', symbol: 'CHI', type: 'ERC-20', decimals: 18 },
      transfers: baseData.transfers.slice(0, TABLE_LIMIT),
      transferCount: baseTxn,
      transferCountSource: baseData.source,
      transferSource: baseData.source,
      transferSourceUrl: baseData.sourceUrl
    } : buildEmptyChain(BASE_CHAIN, baseResult.reason),
    totals: {
      chainHolderTotal,
      allChainTransactions,
      allChainTransactionsSource: 'BaseScan token Transfers total + Etherscan token Transfers total',
      ethTransactions: ethTxn,
      baseTransactions: baseTxn
    },
    transactions: {
      totalCount: allChainTransactions,
      ethTotalCount: ethTxn,
      baseTotalCount: baseTxn,
      ethLoadedRows: ethData?.transfers?.length || 0,
      baseLoadedRows: baseData?.transfers?.length || 0,
      rows: allRows,
      source: 'BaseScan ERC-20 Transfer history + Etherscan ERC-20 Transfer history'
    },
    warnings
  };

  // Only cache a response that has both chain totals. Never cache zeros/blanks over good data.
  if (Number.isFinite(ethTxn) && Number.isFinite(baseTxn)) {
    memoryCache = { cachedAt: now, payload };
  }

  return payload;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const requestUrl = new URL(req.url || '/', 'https://chili-coin.local');
  const force = requestUrl.searchParams.get('force') === '1';
  res.setHeader('Cache-Control', force ? 'no-store, max-age=0' : 's-maxage=15, stale-while-revalidate=45');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const payload = await buildLivePayload({ force });
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(200).json({
      ok: false,
      fetchedAt: new Date().toISOString(),
      dataMode: { mode: 'v24-simple-txn-sum', explorerApiKeyConfigured: Boolean(getExplorerApiKey()) },
      contracts: { ethereumToken: ETH_TOKEN, baseToken: BASE_TOKEN },
      ethereum: buildEmptyChain(ETH_CHAIN, null),
      base: buildEmptyChain(BASE_CHAIN, null),
      totals: { chainHolderTotal: null, allChainTransactions: null },
      transactions: { totalCount: null, rows: [] },
      warnings: [`Live payload failed: ${error.message}`]
    });
  }
}
