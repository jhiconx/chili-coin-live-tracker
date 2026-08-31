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
const API_TIMEOUT_MS = 9000;
const PAGE_TIMEOUT_MS = 14000;
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
        'user-agent': 'Mozilla/5.0 (compatible; ChiliCoinLiveTracker/21.0)'
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
  if (data.status === '1') return data.result;
  const message = String(data.result || data.message || 'Explorer API NOTOK');
  if (/no transactions found|no records found/i.test(message)) return [];
  throw new Error(message);
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

function toPlainText(value) {
  return decodeEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nearbyNumber(text, labels, maxDistance = 220, min = 0, max = 1000000000) {
  const source = String(text || '');
  for (const label of labels) {
    const re = new RegExp(`${label}([\\s\\S]{0,${maxDistance}})`, 'i');
    const match = source.match(re);
    if (!match) continue;
    const without24h = match[1].replace(/\b24H\b/gi, ' ');
    const nums = without24h.match(/\b\d[\d,]*\b/g) || [];
    for (const raw of nums) {
      const n = asNumber(raw);
      if (Number.isInteger(n) && n >= min && n <= max && n !== 24) return n;
    }
  }
  return null;
}

function parseExplorerCounts(content) {
  const raw = String(content || '');
  const plain = toPlainText(raw);
  const textChoices = [plain, raw];
  let holders = null;
  let transfers = null;

  for (const text of textChoices) {
    if (!Number.isFinite(holders)) {
      const direct = text.match(/\bHolders?\b\s*[:#-]?\s*([\d,]+)/i)
        || text.match(/\bHOLDERS\b\s*[:#-]?\s*([\d,]+)/i)
        || text.match(/Holders[\s\S]{0,100}?([\d,]+)/i)
        || text.match(/HOLDERS[\s\S]{0,100}?([\d,]+)/i);
      const n = direct ? asNumber(direct[1]) : nearbyNumber(text, ['HOLDERS', 'Holders'], 160, 1, 10000000);
      if (Number.isInteger(n)) holders = n;
    }

    if (!Number.isFinite(transfers)) {
      const direct = text.match(/A\s+total\s+of\s+([\d,]+)\s+(?:transactions?|transfers?|token\s+transfers?)\s+found/i)
        || text.match(/([\d,]+)\s+(?:transactions?|transfers?|token\s+transfers?)\s+found/i)
        || text.match(/\bTRANSFERS\b[\s\S]{0,180}?([\d,]+)/i)
        || text.match(/\bTransfers\b[\s\S]{0,180}?([\d,]+)/i);
      const n = direct ? asNumber(direct[1]) : nearbyNumber(text, ['TRANSFERS', 'Transfers'], 220, 1, 10000000);
      if (Number.isInteger(n) && n !== 24) transfers = n;
    }
  }

  return { holders, transfers };
}

async function fetchExplorerPageCounts(chain) {
  // Correct Jina Reader format: prepend https://r.jina.ai/ to the public explorer URL.
  const url = `https://r.jina.ai/${chain.tokenUrl}`;
  const response = await fetchWithTimeout(url, PAGE_TIMEOUT_MS, 'text/plain, text/markdown, */*');
  if (!response.ok) throw new Error(`${chain.label} explorer page text HTTP ${response.status}`);
  const content = await response.text();
  const counts = parseExplorerCounts(content);
  if (!Number.isFinite(counts.holders) && !Number.isFinite(counts.transfers)) {
    throw new Error(`${chain.label} explorer page did not expose holder/transfer totals`);
  }
  return {
    holders: counts.holders,
    transfers: counts.transfers,
    source: `${chain.label === 'Base' ? 'BaseScan' : 'Etherscan'} public token page`,
    sourceUrl: chain.tokenUrl
  };
}

async function fetchHolderCountViaEtherscan(chain) {
  const result = await etherscanV2({
    chainid: chain.chainid,
    module: 'token',
    action: 'tokenholdercount',
    contractaddress: chain.token
  }, API_TIMEOUT_MS);
  const holders = asNumber(result);
  if (!Number.isFinite(holders)) throw new Error(`${chain.label} holder count unavailable`);
  return { holders, transfers: null, source: `${chain.label} Etherscan tokenholdercount`, sourceUrl: chain.tokenUrl };
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

function decimalAmount(rawValue, rawDecimals) {
  const value = String(rawValue ?? '').trim();
  const decimals = Number(rawDecimals ?? 18);
  if (!/^[0-9]+$/.test(value) || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) return value || null;
  const padded = value.padStart(decimals + 1, '0');
  const whole = decimals === 0 ? padded : padded.slice(0, -decimals);
  const fraction = decimals === 0 ? '' : padded.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function normalizeTokenTx(item, chain, sourceName) {
  const tx = String(item.hash || item.transactionHash || '').toLowerCase();
  const from = String(item.from || '').toLowerCase();
  const to = String(item.to || '').toLowerCase();
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
    amountRaw: String(item.value ?? ''),
    decimals,
    tokenSymbol: item.tokenSymbol || 'CHI',
    sourceWallet: from,
    sourceWalletUrl: `${chain.addressExplorer}/${from}`,
    transactionInitiator: null,
    calledContract: chain.token.toLowerCase(),
    methodId: null,
    functionName: item.functionName || null,
    logIndex: String(item.logIndex ?? item.transactionIndex ?? item.nonce ?? ''),
    sourceKind: 'erc20-transfer-event',
    sourceName
  };
}

function getHash(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.toLowerCase();
  return String(value.hash || value.address_hash || value.address || '').toLowerCase();
}

function normalizeBlockscoutTransfer(item, chain) {
  const from = getHash(item.from);
  const to = getHash(item.to);
  const tx = String(item.transaction_hash || item.transactionHash || item.hash || '').toLowerCase();
  if (!tx || !from || !to) return null;
  const tokenHash = String(item.token?.address_hash || item.token?.address || chain.token).toLowerCase();
  if (tokenHash && tokenHash !== chain.token.toLowerCase()) return null;
  const decimals = asNumber(item.total?.decimals ?? item.token?.decimals) ?? 18;
  const value = item.total?.value ?? item.value ?? item.amount;
  let event = 'Transfer';
  if (from === ZERO_ADDRESS) event = 'Mint';
  else if (to === ZERO_ADDRESS) event = 'Burn';
  return {
    chain: chain.label,
    chainKey: chain.key,
    transactionHash: tx,
    transactionUrl: `${chain.txExplorer}/${tx}`,
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
    logIndex: String(item.log_index ?? item.logIndex ?? item.index ?? ''),
    sourceKind: 'erc20-transfer-event',
    sourceName: `${chain.label} Blockscout token transfers`
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
  return out.sort(sortTransfers);
}

async function fetchTokenTxRows(chain, page = 1, offset = TABLE_RECORD_LIMIT) {
  const result = await etherscanV2({
    chainid: chain.chainid,
    module: 'account',
    action: 'tokentx',
    contractaddress: chain.token,
    startblock: 0,
    endblock: 99999999,
    page,
    offset,
    sort: 'desc'
  }, API_TIMEOUT_MS);
  const rows = Array.isArray(result) ? result : [];
  return dedupeTransfers(rows.map(item => normalizeTokenTx(item, chain, `${chain.label} Etherscan V2 token transfers`))).slice(0, TABLE_RECORD_LIMIT);
}

async function fetchLegacyBaseScanTokenTxRows(page = 1, offset = TABLE_RECORD_LIMIT) {
  const result = await legacyExplorerApi('https://api.basescan.org/api', {
    module: 'account',
    action: 'tokentx',
    contractaddress: BASE_TOKEN,
    startblock: 0,
    endblock: 99999999,
    page,
    offset,
    sort: 'desc'
  }, API_TIMEOUT_MS);
  const rows = Array.isArray(result) ? result : [];
  return dedupeTransfers(rows.map(item => normalizeTokenTx(item, CHAINS.base, 'BaseScan legacy token transfers'))).slice(0, TABLE_RECORD_LIMIT);
}

async function fetchBlockscoutTransferRows(chain, pages = 4) {
  let url = `${chain.blockscoutApi}/tokens/${chain.token}/transfers`;
  const raw = [];
  for (let i = 0; i < pages && url; i += 1) {
    const data = await fetchJson(url, BLOCKSCOUT_TIMEOUT_MS);
    raw.push(...(Array.isArray(data.items) ? data.items : []));
    const next = data.next_page_params;
    if (!next || typeof next !== 'object') break;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) {
      if (value !== null && value !== undefined) params.set(key, String(value));
    }
    url = `${chain.blockscoutApi}/tokens/${chain.token}/transfers?${params.toString()}`;
  }
  return dedupeTransfers(raw.map(item => normalizeBlockscoutTransfer(item, chain))).slice(0, TABLE_RECORD_LIMIT);
}

async function firstSuccessfulRows(label, attempts) {
  const results = await Promise.allSettled(attempts.map(a => withTimeout(a.promise, a.timeout || API_TIMEOUT_MS, a.label || label)));
  const warnings = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && Array.isArray(result.value) && result.value.length) {
      return { rows: result.value, source: attempts[results.indexOf(result)]?.source || label, warnings };
    }
    if (result.status === 'rejected') warnings.push(`${label} skipped: ${result.reason?.message || String(result.reason)}`);
  }
  return { rows: [], source: null, warnings };
}

async function getOfficialCounts(chain) {
  const warnings = [];
  const manualHolders = chain.key === 'base' ? asNumber(process.env.BASESCAN_BASE_HOLDERS || process.env.BASE_HOLDERS_OVERRIDE) : null;
  const manualTransfers = chain.key === 'base' ? asNumber(process.env.BASESCAN_BASE_TRANSFERS || process.env.BASE_TRANSFERS_OVERRIDE) : null;
  if (Number.isFinite(manualHolders) || Number.isFinite(manualTransfers)) {
    return { holders: manualHolders, transfers: manualTransfers, source: 'Configured official count override', sourceUrl: chain.tokenUrl, warnings };
  }

  const pageResult = await Promise.allSettled([fetchExplorerPageCounts(chain)]);
  if (pageResult[0].status === 'fulfilled') return { ...pageResult[0].value, warnings };
  warnings.push(`${chain.label} explorer page count skipped: ${pageResult[0].reason?.message || String(pageResult[0].reason)}`);

  if (getExplorerApiKey()) {
    const holderResult = await Promise.allSettled([fetchHolderCountViaEtherscan(chain)]);
    if (holderResult[0].status === 'fulfilled') return { ...holderResult[0].value, warnings };
    warnings.push(`${chain.label} holder API skipped: ${holderResult[0].reason?.message || String(holderResult[0].reason)}`);
  }

  if (chain.key === 'ethereum') {
    const blockResult = await Promise.allSettled([fetchBlockscoutCounters(chain)]);
    if (blockResult[0].status === 'fulfilled') return { ...blockResult[0].value, warnings };
    warnings.push(`${chain.label} Blockscout counters skipped: ${blockResult[0].reason?.message || String(blockResult[0].reason)}`);
  }

  return { holders: null, transfers: null, source: null, sourceUrl: chain.tokenUrl, warnings };
}

async function fetchChain(chain) {
  const warnings = [];
  const [countsResult, tokenResult, rowsResult] = await Promise.allSettled([
    getOfficialCounts(chain),
    fetchTokenInfo(chain),
    firstSuccessfulRows(`${chain.label} transfer rows`, [
      ...(chain.key === 'base' ? [{ promise: fetchLegacyBaseScanTokenTxRows(), timeout: API_TIMEOUT_MS, source: 'BaseScan legacy token transfers', label: 'BaseScan legacy tokentx' }] : []),
      ...(getExplorerApiKey() ? [{ promise: fetchTokenTxRows(chain), timeout: API_TIMEOUT_MS, source: `${chain.label} Etherscan V2 token transfers`, label: `${chain.label} Etherscan V2 tokentx` }] : []),
      { promise: fetchBlockscoutTransferRows(chain, chain.key === 'base' ? 6 : 4), timeout: BLOCKSCOUT_TIMEOUT_MS * 2, source: `${chain.label} Blockscout token transfers`, label: `${chain.label} Blockscout transfer rows` }
    ])
  ]);

  let counts = { holders: null, transfers: null, source: null, sourceUrl: chain.tokenUrl, warnings: [] };
  if (countsResult.status === 'fulfilled') counts = countsResult.value;
  else warnings.push(`${chain.label} official counts unavailable: ${countsResult.reason?.message || String(countsResult.reason)}`);
  warnings.push(...(counts.warnings || []));

  const token = tokenResult.status === 'fulfilled' ? tokenResult.value : null;
  if (tokenResult.status === 'rejected') warnings.push(`${chain.label} token metadata skipped: ${tokenResult.reason?.message || String(tokenResult.reason)}`);

  const rowsBundle = rowsResult.status === 'fulfilled' ? rowsResult.value : { rows: [], source: null, warnings: [] };
  if (rowsResult.status === 'rejected') warnings.push(`${chain.label} transfer rows unavailable: ${rowsResult.reason?.message || String(rowsResult.reason)}`);
  warnings.push(...(rowsBundle.warnings || []));

  const holders = Number.isFinite(counts.holders) ? counts.holders : (Number.isFinite(token?.count) && chain.key === 'ethereum' ? token.count : null);
  const transferCount = Number.isFinite(counts.transfers) ? counts.transfers : null;
  const transfers = rowsBundle.rows || [];

  return {
    holders,
    holderSource: Number.isFinite(counts.holders) ? counts.source : null,
    holderSourceUrl: counts.sourceUrl || chain.tokenUrl,
    explorerUrl: chain.transferUrl,
    transferExplorerUrl: chain.transferUrl,
    token,
    transfers,
    transferCount,
    visibleTransferCount: transfers.length,
    transferSource: Number.isFinite(counts.transfers) ? counts.source : rowsBundle.source,
    transferSourceUrl: counts.sourceUrl || chain.transferUrl,
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
  res.setHeader('Cache-Control', force ? 'no-store, max-age=0' : 's-maxage=20, stale-while-revalidate=180');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const warnings = [];
  const rawKey = String(process.env.ETHERSCAN_API_KEY || process.env.BASESCAN_API_KEY || '').trim();
  if (!rawKey) warnings.push('No ETHERSCAN_API_KEY or BASESCAN_API_KEY visible to this deployment.');
  if (/^sk_live/i.test(rawKey)) warnings.push('Configured API key looks like a non-Etherscan key and was ignored.');

  const [ethResult, baseResult] = await Promise.allSettled([
    withTimeout(fetchChain(CHAINS.ethereum), 19000, 'Ethereum chain load'),
    withTimeout(fetchChain(CHAINS.base), 19000, 'Base chain load')
  ]);

  const emptyChain = chain => ({
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
    warnings: []
  });

  const ethereum = ethResult.status === 'fulfilled' ? ethResult.value : emptyChain(CHAINS.ethereum);
  const base = baseResult.status === 'fulfilled' ? baseResult.value : emptyChain(CHAINS.base);
  if (ethResult.status === 'rejected') warnings.push(`Ethereum unavailable: ${ethResult.reason?.message || String(ethResult.reason)}`);
  if (baseResult.status === 'rejected') warnings.push(`Base unavailable: ${baseResult.reason?.message || String(baseResult.reason)}`);
  warnings.push(...(ethereum.warnings || []), ...(base.warnings || []));

  const chainTotal = Number.isFinite(ethereum.holders) && Number.isFinite(base.holders) ? ethereum.holders + base.holders : null;
  const records = dedupeTransfers([...(base.transfers || []), ...(ethereum.transfers || [])]).slice(0, TABLE_RECORD_LIMIT);

  const ethTx = Number.isFinite(ethereum.transferCount) ? ethereum.transferCount : null;
  const baseTx = Number.isFinite(base.transferCount) ? base.transferCount : null;
  const totalCount = Number.isFinite(ethTx) && Number.isFinite(baseTx) ? ethTx + baseTx : null;

  return res.status(200).json({
    ok: Boolean(Number.isFinite(ethereum.holders) || Number.isFinite(base.holders) || records.length),
    fetchedAt: new Date().toISOString(),
    refreshSeconds: 20,
    contracts: { ethereumToken: ETH_TOKEN, baseToken: BASE_TOKEN },
    dataMode: {
      mode: 'v21-stable-sources',
      explorerApiKeyConfigured: Boolean(getExplorerApiKey()),
      note: 'V21 uses explorer page counts for official holder/TXN totals, uses API/indexer rows for latest transfers, and never turns missing Base data into zero.'
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
      label: Number.isFinite(totalCount) ? 'All Chain Transactions' : 'Pending Official TXN Count',
      note: 'TXN uses explorer page totals for official all-time counts and latest ERC-20 Transfer rows for the table.',
      records,
      sources: [ethereum.transferSource, base.transferSource, ethereum.holderSource, base.holderSource].filter(Boolean),
      explorerLinks: { ethereum: CHAINS.ethereum.transferUrl, base: CHAINS.base.transferUrl }
    },
    chainTotal,
    chainTotalNote: 'Sum of chain holder totals; it is not deduplicated across chains.',
    warnings
  });
}
