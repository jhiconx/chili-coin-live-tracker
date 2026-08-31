const ETH_TOKEN = '0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA';
const BASE_TOKEN = '0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ETHERSCAN_TOKEN_URL = `https://etherscan.io/token/${ETH_TOKEN}`;
const ETHERSCAN_TX_URL = `https://etherscan.io/token/${ETH_TOKEN}#tokentxns`;
const BASESCAN_TOKEN_URL = `https://basescan.org/token/${BASE_TOKEN}`;
const BASESCAN_TX_URL = `https://basescan.org/token/${BASE_TOKEN}#transactions`;
const TABLE_RECORD_LIMIT = 300;
const DEFAULT_TIMEOUT_MS = 9000;

const CHAINS = {
  ethereum: {
    key: 'ethereum',
    label: 'Ethereum',
    chainid: '1',
    token: ETH_TOKEN,
    tokenUrl: ETHERSCAN_TOKEN_URL,
    transferUrl: ETHERSCAN_TX_URL,
    txExplorer: 'https://etherscan.io/tx',
    addressExplorer: 'https://etherscan.io/address',
    blockscoutApi: 'https://eth.blockscout.com/api/v2'
  },
  base: {
    key: 'base',
    label: 'Base',
    chainid: '8453',
    token: BASE_TOKEN,
    tokenUrl: BASESCAN_TOKEN_URL,
    transferUrl: BASESCAN_TX_URL,
    txExplorer: 'https://basescan.org/tx',
    addressExplorer: 'https://basescan.org/address',
    blockscoutApi: 'https://base.blockscout.com/api/v2'
  }
};

function getExplorerApiKey() {
  const raw = String(process.env.ETHERSCAN_API_KEY || process.env.BASESCAN_API_KEY || '').trim();
  if (!raw) return null;
  if (/^sk_live/i.test(raw)) return null;
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

async function fetchWithTimeout(url, timeoutMs = DEFAULT_TIMEOUT_MS, accept = 'application/json, text/plain, */*') {
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
        'user-agent': 'Mozilla/5.0 (compatible; ChiliCoinLiveTracker/20.0)'
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const response = await fetchWithTimeout(url, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function etherscanV2(params, timeoutMs = DEFAULT_TIMEOUT_MS) {
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

async function blockscoutJson(chain, path, timeoutMs = 6000) {
  return fetchJson(`${chain.blockscoutApi}${path}`, timeoutMs);
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

function normalizeTokenTx(item, chain) {
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
    sourceName: `${chain.label} Etherscan V2 account tokentx`
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

async function fetchTokenTxPages(chain, pages, timeoutMs = 9000) {
  const pageNumbers = Array.from({ length: pages }, (_, i) => i + 1);
  const pageCalls = pageNumbers.map(page => etherscanV2({
    chainid: chain.chainid,
    module: 'account',
    action: 'tokentx',
    contractaddress: chain.token,
    startblock: 0,
    endblock: 99999999,
    page,
    offset: 1000,
    sort: 'desc'
  }, timeoutMs));
  const results = await Promise.allSettled(pageCalls);
  const errors = [];
  const rows = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) rows.push(...result.value);
    if (result.status === 'rejected') errors.push(result.reason?.message || String(result.reason));
  }
  if (!rows.length && errors.length) throw new Error(errors.join(' | '));
  const seen = new Set();
  const transfers = [];
  for (const raw of rows) {
    const row = normalizeTokenTx(raw, chain);
    if (!row) continue;
    const key = `${row.chainKey}:${row.transactionHash}:${row.logIndex}:${row.from}:${row.to}:${row.amountRaw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    transfers.push(row);
  }
  const sorted = transfers.sort(sortTransfers);
  return {
    transfers: sorted.slice(0, TABLE_RECORD_LIMIT),
    totalTransferCount: sorted.length,
    visibleTransferCount: Math.min(sorted.length, TABLE_RECORD_LIMIT),
    source: `${chain.label} Etherscan V2 account tokentx`,
    sourceUrl: chain.transferUrl,
    warnings: errors
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

async function fetchBlockscoutCounters(chain) {
  const data = await blockscoutJson(chain, `/tokens/${chain.token}/counters`, 6000);
  return {
    holders: asNumber(data.token_holders_count ?? data.holders_count ?? data.holdersCount),
    transfers: asNumber(data.transfers_count ?? data.token_transfers_count ?? data.transfer_count),
    source: `${chain.label} Blockscout token counters`,
    sourceUrl: `${chain.blockscoutApi}/tokens/${chain.token}/counters`
  };
}

async function fetchBlockscoutTokenInfo(chain) {
  const data = await blockscoutJson(chain, `/tokens/${chain.token}`, 6000);
  return {
    count: asNumber(data.holders_count ?? data.holdersCount ?? data.holder_count),
    name: data.name || null,
    symbol: data.symbol || null,
    type: data.type || null,
    decimals: asNumber(data.decimals) ?? 18
  };
}

async function fetchBlockscoutTransfers(chain, pages = 4) {
  const baseUrl = `${chain.blockscoutApi}/tokens/${chain.token}/transfers`;
  let url = baseUrl;
  const transfers = [];
  const seen = new Set();
  for (let i = 0; i < pages && url && transfers.length < TABLE_RECORD_LIMIT; i++) {
    const data = await fetchJson(url, 7000);
    for (const item of (Array.isArray(data.items) ? data.items : [])) {
      const row = normalizeBlockscoutTransfer(item, chain);
      if (!row) continue;
      const key = `${row.chainKey}:${row.transactionHash}:${row.logIndex}:${row.from}:${row.to}:${row.amountRaw}`;
      if (seen.has(key)) continue;
      seen.add(key);
      transfers.push(row);
      if (transfers.length >= TABLE_RECORD_LIMIT) break;
    }
    const next = data.next_page_params;
    if (!next || typeof next !== 'object' || !Object.keys(next).length) break;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v !== null && v !== undefined) qs.set(k, String(v));
    url = `${baseUrl}?${qs.toString()}`;
  }
  return {
    transfers: transfers.sort(sortTransfers).slice(0, TABLE_RECORD_LIMIT),
    visibleTransferCount: transfers.length,
    totalTransferCount: transfers.length,
    source: `${chain.label} Blockscout latest token transfers`,
    sourceUrl: baseUrl
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

function parseExplorerCount(content, kind) {
  const raw = String(content || '');
  const plain = toPlainText(raw);
  if (kind === 'holders') {
    const patterns = [
      /\bHOLDERS\b\s*([\d,]+)/i,
      /\bHolders\b\s*([\d,]+)/i,
      /Holders[\s\S]{0,80}?([\d,]+)/i
    ];
    for (const source of [plain, raw]) {
      for (const pattern of patterns) {
        const match = source.match(pattern);
        const count = match ? asNumber(match[1]) : null;
        if (Number.isInteger(count) && count >= 0) return count;
      }
    }
    return null;
  }
  const patterns = [
    /A\s+total\s+of\s+([\d,]+)\s+transactions?\s+found/i,
    /A\s+total\s+of\s+([\d,]+)\s+transfers?\s+found/i,
    /\bTRANSFERS\b[\s\S]{0,120}?([\d,]+)/i,
    /\bTransfers\b[\s\S]{0,120}?([\d,]+)/i
  ];
  for (const source of [plain, raw]) {
    for (const pattern of patterns) {
      const match = source.match(pattern);
      const count = match ? asNumber(match[1]) : null;
      if (Number.isInteger(count) && count >= 0 && count !== 24) return count;
    }
  }
  return null;
}

async function fetchBaseScanTextSummary() {
  const url = `https://r.jina.ai/http://r.jina.ai/http://https://basescan.org/token/${BASE_TOKEN}`;
  const response = await fetchWithTimeout(url, 12000, 'text/plain, text/markdown, */*');
  if (!response.ok) throw new Error(`BaseScan text mirror HTTP ${response.status}`);
  const content = await response.text();
  const holders = parseExplorerCount(content, 'holders');
  const transfers = parseExplorerCount(content, 'transfers');
  if (!Number.isFinite(holders) && !Number.isFinite(transfers)) throw new Error('BaseScan text mirror did not expose counts');
  return { holders, transfers, source: 'BaseScan public token page text', sourceUrl: BASESCAN_TOKEN_URL };
}

async function fetchHolderCountViaEtherscan(chain) {
  const result = await etherscanV2({
    chainid: chain.chainid,
    module: 'token',
    action: 'tokenholdercount',
    contractaddress: chain.token
  }, 7000);
  return { holders: asNumber(result), transfers: null, source: `${chain.label} Etherscan tokenholdercount`, sourceUrl: chain.tokenUrl };
}

async function firstUseful(promises, test) {
  const results = await Promise.allSettled(promises);
  for (const result of results) {
    if (result.status === 'fulfilled' && test(result.value)) return { value: result.value, results };
  }
  return { value: null, results };
}

function pickMax(...values) {
  const nums = values.filter(v => Number.isFinite(v));
  return nums.length ? Math.max(...nums) : null;
}

async function fetchChain(chain) {
  const warnings = [];
  let counters = null;
  let token = null;
  let transferData = null;

  if (chain.key === 'base') {
    const manualHolders = asNumber(process.env.BASESCAN_BASE_HOLDERS || process.env.BASE_HOLDERS_OVERRIDE);
    const manualTransfers = asNumber(process.env.BASESCAN_BASE_TRANSFERS || process.env.BASE_TRANSFERS_OVERRIDE);
    if (Number.isFinite(manualHolders) || Number.isFinite(manualTransfers)) {
      counters = { holders: manualHolders, transfers: manualTransfers, source: 'Configured BaseScan count override', sourceUrl: BASESCAN_TOKEN_URL };
    } else {
      const { value, results } = await firstUseful([
        fetchHolderCountViaEtherscan(chain),
        fetchBaseScanTextSummary(),
        fetchBlockscoutTokenInfo(chain).then(info => ({ holders: info.count, transfers: null, source: 'Base public token metadata', sourceUrl: chain.tokenUrl }))
      ], v => Number.isFinite(v?.holders) || Number.isFinite(v?.transfers));
      counters = value;
      for (const r of results) if (r.status === 'rejected') warnings.push(`Base count source skipped: ${r.reason?.message || String(r.reason)}`);
    }
  } else {
    const { value, results } = await firstUseful([
      fetchHolderCountViaEtherscan(chain),
      fetchBlockscoutCounters(chain)
    ], v => Number.isFinite(v?.holders) || Number.isFinite(v?.transfers));
    counters = value;
    for (const r of results) if (r.status === 'rejected') warnings.push(`Ethereum count source skipped: ${r.reason?.message || String(r.reason)}`);
  }

  const txPages = chain.key === 'base' ? 4 : 2;
  const { value: txValue, results: txResults } = await firstUseful([
    fetchTokenTxPages(chain, txPages, chain.key === 'base' ? 11000 : 9000),
    fetchBlockscoutTransfers(chain, chain.key === 'base' ? 6 : 4)
  ], v => Array.isArray(v?.transfers) && v.transfers.length);
  transferData = txValue;
  for (const r of txResults) if (r.status === 'rejected') warnings.push(`${chain.label} transfer source skipped: ${r.reason?.message || String(r.reason)}`);

  try { token = await fetchBlockscoutTokenInfo(chain); } catch (e) { warnings.push(`${chain.label} token metadata skipped: ${e?.message || String(e)}`); }

  const holders = Number.isFinite(counters?.holders) ? counters.holders : (Number.isFinite(token?.count) ? token.count : null);
  const transfers = Array.isArray(transferData?.transfers) ? transferData.transfers : [];
  const transferCount = pickMax(counters?.transfers, transferData?.totalTransferCount, transfers.length) ?? (transfers.length || null);

  return {
    holders,
    holderSource: counters?.source || (token ? `${chain.label} public token metadata` : null),
    holderSourceUrl: counters?.sourceUrl || chain.tokenUrl,
    explorerUrl: chain.transferUrl,
    transferExplorerUrl: chain.transferUrl,
    token,
    transfers,
    transferCount,
    visibleTransferCount: transfers.length,
    transferSource: transferData?.source || (counters?.transfers ? counters.source : null),
    transferSourceUrl: transferData?.sourceUrl || counters?.sourceUrl || chain.transferUrl,
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
    Promise.race([fetchChain(CHAINS.ethereum), timeout(18000, 'Ethereum full chain load')]),
    Promise.race([fetchChain(CHAINS.base), timeout(18000, 'Base full chain load')])
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

  const recordMap = new Map();
  for (const row of [...(base.transfers || []), ...(ethereum.transfers || [])].sort(sortTransfers)) {
    const key = `${row.chainKey}:${row.transactionHash}:${row.logIndex}:${row.from}:${row.to}:${row.amountRaw}`;
    if (!recordMap.has(key)) recordMap.set(key, row);
  }
  const records = Array.from(recordMap.values()).sort(sortTransfers).slice(0, TABLE_RECORD_LIMIT);

  const ethTx = Number.isFinite(ethereum.transferCount) ? ethereum.transferCount : null;
  const baseTx = Number.isFinite(base.transferCount) ? base.transferCount : null;
  const totalCount = Number.isFinite(ethTx) && Number.isFinite(baseTx) ? ethTx + baseTx : (Number.isFinite(ethTx) ? ethTx : (Number.isFinite(baseTx) ? baseTx : null));

  return res.status(200).json({
    ok: Boolean(Number.isFinite(ethereum.holders) || Number.isFinite(base.holders) || records.length),
    fetchedAt: new Date().toISOString(),
    refreshSeconds: 20,
    contracts: { ethereumToken: ETH_TOKEN, baseToken: BASE_TOKEN },
    dataMode: {
      mode: 'v20-stable-official-api',
      explorerApiKeyConfigured: Boolean(getExplorerApiKey()),
      note: 'V20 uses Etherscan V2 account tokentx for live ETH/Base rows, keeps Base separate from Ethereum, and never displays unavailable Base data as zero.'
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
      label: Number.isFinite(ethTx) && Number.isFinite(baseTx) ? 'All Chain Transactions' : 'Partial Chain Transactions',
      note: 'TXN counts indexed ERC-20 Transfer events returned by the live sources. Source Wallet is the CHI From wallet, Recipient is the CHI To wallet.',
      records,
      sources: [ethereum.transferSource, base.transferSource, ethereum.holderSource, base.holderSource].filter(Boolean),
      explorerLinks: { ethereum: ETHERSCAN_TX_URL, base: BASESCAN_TX_URL }
    },
    chainTotal,
    chainTotalNote: 'Sum of chain holder totals; it is not deduplicated across chains.',
    warnings
  });
}
