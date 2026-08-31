const ETH_TOKEN = '0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA';
const BASE_TOKEN = '0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const ETHERSCAN_TOKEN_URL = `https://etherscan.io/token/${ETH_TOKEN}`;
const ETHERSCAN_TX_URL = `https://etherscan.io/token/${ETH_TOKEN}#tokentxns`;
const BASESCAN_TOKEN_URL = `https://basescan.org/token/${BASE_TOKEN}`;
const BASESCAN_TX_URL = `https://basescan.org/token/${BASE_TOKEN}#transactions`;

const TIMEOUT_FAST_MS = 8000;
const TIMEOUT_SLOW_MS = 15000;
const TABLE_LIMIT = 300;

let memoryCache = null;

function getExplorerApiKey() {
  const raw = String(process.env.ETHERSCAN_API_KEY || process.env.BASESCAN_API_KEY || '').trim();
  if (!raw || /^sk_live/i.test(raw)) return null;
  return raw;
}

function timeout(ms, label) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms));
}

async function withTimeout(promise, ms, label) {
  return Promise.race([promise, timeout(ms, label)]);
}

async function fetchText(url, timeoutMs = TIMEOUT_FAST_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'text/html,text/plain,application/json,*/*',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36 ChiliCoinLiveTracker/23'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs = TIMEOUT_FAST_MS) {
  const text = await fetchText(url, timeoutMs);
  try { return JSON.parse(text); } catch (error) { throw new Error(`JSON parse failed: ${error.message}`); }
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x2F;/gi, '/');
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
  const text = String(value).replace(/,/g, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function firstNumberAfterLabel(text, label, maxChars = 600) {
  const source = String(text || '');
  const index = source.toLowerCase().indexOf(label.toLowerCase());
  if (index < 0) return null;
  const slice = source.slice(index, index + maxChars);
  const match = slice.match(/([0-9][0-9,]*)/);
  return match ? asNumber(match[1]) : null;
}

function parseBaseScanCounts(content) {
  const raw = String(content || '');
  const plain = toPlainText(raw);
  const candidates = [plain, raw];
  let holders = null;
  let transfers = null;

  for (const source of candidates) {
    if (holders === null) {
      const patterns = [
        /\bHOLDERS\b[\s\S]{0,250}?([0-9][0-9,]*)/i,
        /\bHolders\b[\s\S]{0,250}?([0-9][0-9,]*)/i,
        /"holders[_A-Za-z]*"\s*:\s*"?([0-9][0-9,]*)"?/i
      ];
      for (const pattern of patterns) {
        const match = source.match(pattern);
        const n = match ? asNumber(match[1]) : null;
        if (n !== null && n >= 0 && n < 10000000) { holders = n; break; }
      }
      if (holders === null) holders = firstNumberAfterLabel(source, 'HOLDERS');
    }

    if (transfers === null) {
      const patterns = [
        /\bTRANSFERS\b[\s\S]{0,800}?\bTOTAL\b[\s\S]{0,250}?([0-9][0-9,]*)/i,
        /\bTRANSFERS\b[\s\S]{0,400}?([0-9][0-9,]*)/i,
        /A total of\s*([0-9][0-9,]*)\s*(?:transactions|transfers)\s*found/i,
        /"transfers[_A-Za-z]*"\s*:\s*"?([0-9][0-9,]*)"?/i
      ];
      for (const pattern of patterns) {
        const match = source.match(pattern);
        const n = match ? asNumber(match[1]) : null;
        if (n !== null && n >= 0 && n < 100000000) { transfers = n; break; }
      }
    }
  }

  return { holders, transfers };
}

async function fetchBaseScanVisibleCounts() {
  const attempts = [
    { name: 'BaseScan token page', url: BASESCAN_TOKEN_URL, timeoutMs: TIMEOUT_FAST_MS },
    { name: 'BaseScan token page via text mirror', url: `https://r.jina.ai/${BASESCAN_TOKEN_URL}`, timeoutMs: TIMEOUT_SLOW_MS }
  ];
  const errors = [];
  for (const attempt of attempts) {
    try {
      const text = await fetchText(attempt.url, attempt.timeoutMs);
      const counts = parseBaseScanCounts(text);
      if (counts.holders !== null || counts.transfers !== null) {
        return { ...counts, source: attempt.name, sourceUrl: BASESCAN_TOKEN_URL };
      }
      throw new Error('BaseScan counts were not found in response text');
    } catch (error) {
      errors.push(`${attempt.name}: ${error.message}`);
    }
  }
  throw new Error(errors.join(' | '));
}

function normalizeAddress(value) {
  const text = String(value || '').trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(text) ? text : '';
}

function decimalAmount(rawValue, rawDecimals) {
  const value = String(rawValue ?? '').trim();
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
  const decimals = asNumber(item.tokenDecimal ?? item.tokenDecimals ?? item.decimals) ?? 18;
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

async function etherscanV2(params, timeoutMs = TIMEOUT_FAST_MS) {
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
  const msg = String(data.result || data.message || 'Etherscan API NOTOK');
  if (/no transactions found|no records found/i.test(msg)) return [];
  throw new Error(msg);
}

async function legacyApi(root, params, timeoutMs = TIMEOUT_FAST_MS) {
  const apiKey = getExplorerApiKey();
  const url = new URL(root);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  if (apiKey) url.searchParams.set('apikey', apiKey);
  const data = await fetchJson(url.toString(), timeoutMs);
  if (data.status === '1' && Array.isArray(data.result)) return data.result;
  if (Array.isArray(data.result)) return data.result;
  const msg = String(data.result || data.message || 'Explorer API NOTOK');
  if (/no transactions found|no records found/i.test(msg)) return [];
  throw new Error(msg);
}

async function fetchBaseLatestTransfers() {
  const chain = {
    key: 'base', label: 'Base', token: BASE_TOKEN,
    txExplorer: 'https://basescan.org/tx', addressExplorer: 'https://basescan.org/address',
    sourceName: 'Base CHI ERC-20 transfer feed'
  };
  const attempts = [
    async () => etherscanV2({ chainid: '8453', module: 'account', action: 'tokentx', contractaddress: BASE_TOKEN, page: 1, offset: 100, sort: 'desc' }, TIMEOUT_FAST_MS),
    async () => legacyApi('https://api.basescan.org/api', { module: 'account', action: 'tokentx', contractaddress: BASE_TOKEN, page: 1, offset: 100, sort: 'desc' }, TIMEOUT_FAST_MS),
    async () => legacyApi('https://base.blockscout.com/api', { module: 'account', action: 'tokentx', contractaddress: BASE_TOKEN, page: 1, offset: 100, sort: 'desc' }, TIMEOUT_FAST_MS)
  ];
  const errors = [];
  for (const attempt of attempts) {
    try {
      const rawRows = await attempt();
      const rows = dedupeTransfers(rawRows.map(row => normalizeTokenTx(row, chain))).sort(sortTransfers);
      if (rows.length) return { rows, source: rows[0].sourceName, sourceUrl: BASESCAN_TX_URL };
      errors.push('attempt returned zero rows');
    } catch (error) { errors.push(error.message); }
  }
  throw new Error(errors.join(' | '));
}

async function fetchEthHolders() {
  const data = await fetchJson(`https://eth.blockscout.com/api/v2/tokens/${ETH_TOKEN}`, TIMEOUT_FAST_MS);
  const count = asNumber(data.holders_count ?? data.holder_count ?? data.holdersCount);
  return { count, token: { name: data.name || 'Chili Coin', symbol: data.symbol || 'CHI', type: data.type || 'ERC-20', decimals: asNumber(data.decimals) ?? 18 }, source: 'Ethereum Blockscout token counters', sourceUrl: `https://eth.blockscout.com/token/${ETH_TOKEN}` };
}

async function fetchEthTransfers() {
  const chain = { key: 'ethereum', label: 'Ethereum', token: ETH_TOKEN, txExplorer: 'https://etherscan.io/tx', addressExplorer: 'https://etherscan.io/address', sourceName: 'Ethereum Etherscan API token transfers' };
  const rowsRaw = await etherscanV2({ chainid: '1', module: 'account', action: 'tokentx', contractaddress: ETH_TOKEN, page: 1, offset: 100, sort: 'desc' }, TIMEOUT_FAST_MS);
  const rows = dedupeTransfers(rowsRaw.map(row => normalizeTokenTx(row, chain))).sort(sortTransfers);
  return { rows, source: 'Ethereum Etherscan API token transfers', sourceUrl: ETHERSCAN_TX_URL };
}

async function fetchBaseStandalone() {
  const fetchedAt = new Date().toISOString();
  const [countsResult, rowsResult] = await Promise.allSettled([
    withTimeout(fetchBaseScanVisibleCounts(), TIMEOUT_SLOW_MS, 'BaseScan visible counts'),
    withTimeout(fetchBaseLatestTransfers(), TIMEOUT_SLOW_MS, 'Base transfer rows')
  ]);
  const warnings = [];
  let counts = null;
  let rowsPayload = null;
  if (countsResult.status === 'fulfilled') counts = countsResult.value;
  else warnings.push(`Base visible counts unavailable: ${countsResult.reason?.message || 'unknown'}`);
  if (rowsResult.status === 'fulfilled') rowsPayload = rowsResult.value;
  else warnings.push(`Base latest transfer rows unavailable: ${rowsResult.reason?.message || 'unknown'}`);
  return {
    ok: Boolean(counts || rowsPayload),
    fetchedAt,
    chain: 'Base',
    token: BASE_TOKEN,
    explorerUrl: BASESCAN_TOKEN_URL,
    transferExplorerUrl: BASESCAN_TX_URL,
    holders: counts?.holders ?? null,
    holderSource: counts?.holders !== null && counts?.holders !== undefined ? counts.source : null,
    holderSourceUrl: counts?.sourceUrl || BASESCAN_TOKEN_URL,
    transferCount: counts?.transfers ?? null,
    transferCountSource: counts?.transfers !== null && counts?.transfers !== undefined ? counts.source : null,
    transferSource: rowsPayload?.source || null,
    transferSourceUrl: rowsPayload?.sourceUrl || BASESCAN_TX_URL,
    transfers: rowsPayload?.rows || [],
    warnings
  };
}

function mergeWithLastGood(current) {
  if (!memoryCache) return current;
  const merged = JSON.parse(JSON.stringify(current));
  if ((merged.base?.holders === null || merged.base?.holders === undefined) && Number.isFinite(memoryCache.base?.holders)) {
    merged.base.holders = memoryCache.base.holders;
    merged.base.holderSource = `${memoryCache.base.holderSource || 'last good Base value'} (last good)`;
    merged.warnings.push('Base holder refresh failed; using last good server value.');
  }
  if ((merged.base?.transferCount === null || merged.base?.transferCount === undefined) && Number.isFinite(memoryCache.base?.transferCount)) {
    merged.base.transferCount = memoryCache.base.transferCount;
    merged.base.transferCountSource = `${memoryCache.base.transferCountSource || 'last good Base TXN value'} (last good)`;
    merged.warnings.push('Base transfer-count refresh failed; using last good server value.');
  }
  if ((!merged.base?.transfers || !merged.base.transfers.length) && memoryCache.base?.transfers?.length) {
    merged.base.transfers = memoryCache.base.transfers;
    merged.base.transferSource = `${memoryCache.base.transferSource || 'last good Base rows'} (last good)`;
    merged.warnings.push('Base transfer-row refresh failed; using last good server rows.');
  }
  return merged;
}

export async function buildLivePayload() {
  const fetchedAt = new Date().toISOString();
  const [ethHolderResult, ethTransferResult, baseResult] = await Promise.allSettled([
    withTimeout(fetchEthHolders(), TIMEOUT_FAST_MS, 'Ethereum holders'),
    withTimeout(fetchEthTransfers(), TIMEOUT_SLOW_MS, 'Ethereum transfers'),
    withTimeout(fetchBaseStandalone(), TIMEOUT_SLOW_MS + 2000, 'Base standalone')
  ]);

  const warnings = [];
  const ethHolder = ethHolderResult.status === 'fulfilled' ? ethHolderResult.value : null;
  const ethTransfer = ethTransferResult.status === 'fulfilled' ? ethTransferResult.value : null;
  const base = baseResult.status === 'fulfilled' ? baseResult.value : null;
  if (!ethHolder) warnings.push(`Ethereum holder source unavailable: ${ethHolderResult.reason?.message || 'unknown'}`);
  if (!ethTransfer) warnings.push(`Ethereum transfer source unavailable: ${ethTransferResult.reason?.message || 'unknown'}`);
  if (!base) warnings.push(`Base standalone source unavailable: ${baseResult.reason?.message || 'unknown'}`);
  if (base?.warnings?.length) warnings.push(...base.warnings);

  const ethHolders = ethHolder?.count ?? null;
  const baseHolders = base?.holders ?? null;
  const chainTotal = Number.isFinite(ethHolders) && Number.isFinite(baseHolders) ? ethHolders + baseHolders : null;
  const ethTransfers = ethTransfer?.rows || [];
  const baseTransfers = base?.transfers || [];
  const baseTransferCount = base?.transferCount ?? null;
  const ethTransferCount = ethTransfers.length || null; // This is latest loaded ETH rows when full count is unavailable.
  const allChainTransactions = Number.isFinite(baseTransferCount) && Number.isFinite(ethTransferCount) ? baseTransferCount + ethTransferCount : (baseTransferCount ?? ethTransferCount ?? null);
  const allRows = dedupeTransfers([...baseTransfers, ...ethTransfers]).sort(sortTransfers).slice(0, TABLE_LIMIT);

  let payload = {
    ok: Boolean(ethHolder || ethTransfer || base),
    fetchedAt,
    refreshSeconds: 20,
    dataMode: {
      mode: 'v23-base-reset-standalone',
      baseDesign: 'Base is read independently from BaseScan visible counts and Base transfer rows. Failed Base refreshes do not become zero.',
      explorerApiKeyConfigured: Boolean(getExplorerApiKey())
    },
    contracts: { ethereumToken: ETH_TOKEN, baseToken: BASE_TOKEN },
    ethereum: {
      holders: ethHolders,
      holderSource: ethHolder?.source || null,
      holderSourceUrl: ethHolder?.sourceUrl || null,
      explorerUrl: ETHERSCAN_TOKEN_URL,
      transferExplorerUrl: ETHERSCAN_TX_URL,
      token: ethHolder?.token || null,
      transfers: ethTransfers,
      transferCount: ethTransferCount,
      transferSource: ethTransfer?.source || null,
      transferSourceUrl: ethTransfer?.sourceUrl || null
    },
    base: {
      holders: baseHolders,
      holderSource: base?.holderSource || null,
      holderSourceUrl: base?.holderSourceUrl || BASESCAN_TOKEN_URL,
      explorerUrl: BASESCAN_TOKEN_URL,
      transferExplorerUrl: BASESCAN_TX_URL,
      token: { name: 'ChiliCoin', symbol: 'CHI', type: 'ERC-20', decimals: 18 },
      transfers: baseTransfers,
      transferCount: baseTransferCount,
      transferCountSource: base?.transferCountSource || null,
      transferSource: base?.transferSource || null,
      transferSourceUrl: base?.transferSourceUrl || null
    },
    totals: {
      chainHolderTotal: chainTotal,
      allChainTransactions,
      allChainTransactionsSource: Number.isFinite(baseTransferCount) ? 'BaseScan visible transfer count + loaded Ethereum transfer rows' : 'Loaded transfer rows only',
      baseContributedToTxn: Number.isFinite(baseTransferCount)
    },
    transactions: {
      totalCount: allChainTransactions,
      ethLoadedRows: ethTransfers.length,
      baseLoadedRows: baseTransfers.length,
      baseTotalCount: baseTransferCount,
      rows: allRows,
      source: [base?.transferSource, ethTransfer?.source].filter(Boolean).join(' + ')
    },
    warnings
  };

  payload = mergeWithLastGood(payload);

  if (payload.base?.holders || payload.base?.transferCount || payload.base?.transfers?.length) {
    memoryCache = JSON.parse(JSON.stringify(payload));
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
    const payload = await buildLivePayload();
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(200).json({
      ok: false,
      fetchedAt: new Date().toISOString(),
      dataMode: { mode: 'v23-base-reset-standalone', explorerApiKeyConfigured: Boolean(getExplorerApiKey()) },
      contracts: { ethereumToken: ETH_TOKEN, baseToken: BASE_TOKEN },
      warnings: [`Live payload failed: ${error.message}`]
    });
  }
}
