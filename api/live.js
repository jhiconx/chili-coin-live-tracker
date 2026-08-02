const ETH_TOKEN = '0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA';
const BASE_TOKEN = '0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ETHERSCAN_URL = `https://etherscan.io/token/${ETH_TOKEN}`;
const ETHERSCAN_TX_URL = `https://etherscan.io/token/${ETH_TOKEN}#tokentxns`;
const BASESCAN_URL = `https://basescan.org/token/${BASE_TOKEN}#transactions`;
const TIMEOUT_MS = 12_000;
const TABLE_RECORD_LIMIT = 300;
const RECORDS_PER_CHAIN_LIMIT = 300;
const MAX_TRANSFER_PAGES = 12;

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

      return {
        count,
        source: attempt.source,
        sourceUrl: BASESCAN_URL
      };
    } catch (error) {
      failures.push(`${attempt.source}: ${error.message}`);
    }
  }

  throw new Error(failures.join(' | '));
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url, {
    headers: { accept: 'application/json' }
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchTokenInfo(apiRoot, token) {
  const data = await fetchJson(`${apiRoot}/tokens/${token}`);
  const count = Number(data.holders_count ?? data.holdersCount ?? data.holder_count);

  return {
    count: Number.isFinite(count) ? count : null,
    name: data.name || null,
    symbol: data.symbol || null,
    type: data.type || null,
    decimals: Number(data.decimals ?? 18)
  };
}

async function fetchTokenCounters(apiRoot, token) {
  const data = await fetchJson(`${apiRoot}/tokens/${token}/counters`);

  const holders = Number(data.token_holders_count ?? data.holders_count);
  const transfers = Number(data.transfers_count ?? data.token_transfers_count);

  return {
    holders: Number.isFinite(holders) ? holders : null,
    transfers: Number.isFinite(transfers) ? transfers : null
  };
}

function decimalAmount(rawValue, rawDecimals) {
  const value = String(rawValue ?? '').trim();
  const decimals = Number(rawDecimals ?? 18);

  if (!/^\d+$/.test(value) || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    return value || null;
  }

  const padded = value.padStart(decimals + 1, '0');
  const whole = decimals === 0 ? padded : padded.slice(0, -decimals);
  const fraction = decimals === 0 ? '' : padded.slice(-decimals).replace(/0+$/, '');

  return fraction ? `${whole}.${fraction}` : whole;
}

function extractAddress(value) {
  if (typeof value === 'string') return value.toLowerCase();

  const raw = value?.hash
    || value?.address_hash?.hash
    || value?.address_hash
    || value?.address;

  return typeof raw === 'string' ? raw.toLowerCase() : '';
}

function normalizeV2Transfer(item, chain) {
  const tokenAddress = extractAddress(item.token?.address_hash || item.token?.address)
    || chain.token.toLowerCase();

  if (tokenAddress !== chain.token.toLowerCase()) return null;

  const from = extractAddress(item.from);
  const to = extractAddress(item.to);
  const transactionHash = String(item.transaction_hash || item.hash || '').toLowerCase();

  if (!transactionHash || !from || !to) return null;

  const rawValue = item.total?.value ?? item.value ?? '';
  const decimals = Number(item.total?.decimals ?? item.token?.decimals ?? 18);

  let event = 'Transfer';
  if (from === ZERO_ADDRESS) event = 'Mint';
  else if (to === ZERO_ADDRESS) event = 'Burn';

  return {
    chain: chain.label,
    chainKey: chain.key,
    transactionHash,
    transactionUrl: `${chain.txExplorer}/${transactionHash}`,
    blockNumber: String(item.block_number ?? item.blockNumber ?? ''),
    logIndex: String(item.log_index ?? item.index ?? ''),
    timestamp: item.timestamp || null,
    from,
    to,
    fromUrl: `${chain.addressExplorer}/${from}`,
    toUrl: `${chain.addressExplorer}/${to}`,
    event,
    method: item.method || null,
    amount: decimalAmount(rawValue, decimals),
    amountRaw: String(rawValue),
    decimals,
    tokenSymbol: item.token?.symbol || 'CHI'
  };
}

async function fetchLatestTokenTransfers(chain, recordLimit = RECORDS_PER_CHAIN_LIMIT) {
  const transfers = [];
  const seen = new Set();
  let nextPageParams = null;
  let pageCount = 0;

  do {
    const url = new URL(`${chain.apiV2}/tokens/${chain.token}/transfers`);

    if (nextPageParams) {
      for (const [key, value] of Object.entries(nextPageParams)) {
        if (value !== null && value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const data = await fetchJson(url.toString());

    if (!Array.isArray(data.items)) {
      throw new Error('Unexpected Blockscout v2 transfer response');
    }

    for (const item of data.items) {
      const transfer = normalizeV2Transfer(item, chain);
      if (!transfer) continue;

      const key = `${transfer.chainKey}:${transfer.transactionHash}:${transfer.logIndex}`;
      if (seen.has(key)) continue;

      seen.add(key);
      transfers.push(transfer);

      if (transfers.length >= recordLimit) break;
    }

    nextPageParams = data.next_page_params || null;
    pageCount += 1;
  } while (
    nextPageParams
    && transfers.length < recordLimit
    && pageCount < MAX_TRANSFER_PAGES
  );

  return {
    transfers,
    fetchedCount: transfers.length,
    pagesFetched: pageCount,
    source: `${chain.label} Blockscout v2 token-transfer feed`,
    sourceUrl: chain.sourceUrl,
    explorerUrl: chain.explorerUrl
  };
}

async function fetchContractTransactions(chain, offset = '250') {
  const params = new URLSearchParams({
    module: 'account',
    action: 'txlist',
    address: chain.token,
    page: '1',
    offset,
    sort: 'desc'
  });

  const url = `${chain.compatApi}?${params.toString()}`;
  const response = await fetchWithTimeout(url, {
    headers: { accept: 'application/json' }
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();
  const result = Array.isArray(data.result) ? data.result : [];

  if (!result.length && data.status !== '1') {
    throw new Error(String(data.message || data.result || 'No contract transactions returned'));
  }

  const byHash = new Map();

  for (const tx of result) {
    const hash = String(tx.hash || '').toLowerCase();
    if (!hash) continue;

    byHash.set(hash, {
      transactionHash: hash,
      initiator: String(tx.from || '').toLowerCase(),
      calledContract: String(tx.to || chain.token).toLowerCase(),
      methodId: tx.methodId || null,
      functionName: tx.functionName || null,
      isError: tx.isError === '1',
      timestamp: tx.timeStamp
        ? new Date(Number(tx.timeStamp) * 1000).toISOString()
        : null,
      blockNumber: String(tx.blockNumber || '')
    });
  }

  return {
    transactions: [...byHash.values()],
    byHash,
    source: `${chain.label} Blockscout transaction-signer feed`,
    sourceUrl: `${chain.sourceUrl}&view=contract_transactions`
  };
}

function enrichTransfersWithTransactions(transfers, txInfo) {
  const txMap = txInfo?.byHash instanceof Map
    ? txInfo.byHash
    : new Map();

  return transfers.map(transfer => {
    const tx = txMap.get(String(transfer.transactionHash || '').toLowerCase());
    const initiator = tx?.initiator || transfer.from || null;

    return {
      ...transfer,
      sourceWallet: initiator,
      sourceWalletUrl: initiator
        ? `${transfer.chainKey === 'ethereum'
          ? 'https://etherscan.io/address'
          : 'https://basescan.org/address'}/${initiator}`
        : null,
      transactionInitiator: tx?.initiator || null,
      calledContract: tx?.calledContract || null,
      methodId: tx?.methodId || null,
      functionName: tx?.functionName || transfer.method || null,
      transactionLevelTimestamp: tx?.timestamp || null,
      timestamp: transfer.timestamp || tx?.timestamp || null,
      blockNumber: transfer.blockNumber || tx?.blockNumber || ''
    };
  });
}

function sortTransfers(a, b) {
  const timeA = a.timestamp ? Date.parse(a.timestamp) : 0;
  const timeB = b.timestamp ? Date.parse(b.timestamp) : 0;

  if (timeA !== timeB) return timeB - timeA;

  const blockDifference = Number(b.blockNumber || 0) - Number(a.blockNumber || 0);
  if (blockDifference !== 0) return blockDifference;

  return Number(b.logIndex || 0) - Number(a.logIndex || 0);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestUrl = new URL(req.url || '/', 'https://chili-coin.local');
  const force = requestUrl.searchParams.get('force') === '1';

  res.setHeader(
    'Cache-Control',
    force
      ? 'no-store, max-age=0'
      : 's-maxage=10, stale-while-revalidate=20'
  );
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const fetchedAt = new Date().toISOString();

  const chainConfigs = {
    ethereum: {
      key: 'ethereum',
      label: 'Ethereum',
      token: ETH_TOKEN,
      apiV2: 'https://eth.blockscout.com/api/v2',
      compatApi: 'https://eth.blockscout.com/api',
      txExplorer: 'https://etherscan.io/tx',
      addressExplorer: 'https://etherscan.io/address',
      sourceUrl: `https://eth.blockscout.com/token/${ETH_TOKEN}?tab=token_transfers`,
      explorerUrl: ETHERSCAN_TX_URL
    },
    base: {
      key: 'base',
      label: 'Base',
      token: BASE_TOKEN,
      apiV2: 'https://base.blockscout.com/api/v2',
      compatApi: 'https://base.blockscout.com/api',
      txExplorer: 'https://basescan.org/tx',
      addressExplorer: 'https://basescan.org/address',
      sourceUrl: `https://base.blockscout.com/token/${BASE_TOKEN}?tab=token_transfers`,
      explorerUrl: BASESCAN_URL
    }
  };

  const [
    baseScan,
    ethInfo,
    baseInfo,
    ethCounters,
    baseCounters,
    ethTransfers,
    baseTransfers,
    ethContractTxs,
    baseContractTxs
  ] = await Promise.allSettled([
    fetchBaseScanHolderCount(),
    fetchTokenInfo(chainConfigs.ethereum.apiV2, ETH_TOKEN),
    fetchTokenInfo(chainConfigs.base.apiV2, BASE_TOKEN),
    fetchTokenCounters(chainConfigs.ethereum.apiV2, ETH_TOKEN),
    fetchTokenCounters(chainConfigs.base.apiV2, BASE_TOKEN),
    fetchLatestTokenTransfers(chainConfigs.ethereum),
    fetchLatestTokenTransfers(chainConfigs.base),
    fetchContractTransactions(chainConfigs.ethereum),
    fetchContractTransactions(chainConfigs.base)
  ]);

  const warnings = [];

  const baseScanValue = baseScan.status === 'fulfilled' ? baseScan.value : null;
  const ethValue = ethInfo.status === 'fulfilled' ? ethInfo.value : null;
  const baseInfoValue = baseInfo.status === 'fulfilled' ? baseInfo.value : null;
  const ethCounterValue = ethCounters.status === 'fulfilled' ? ethCounters.value : null;
  const baseCounterValue = baseCounters.status === 'fulfilled' ? baseCounters.value : null;
  const ethTransferValue = ethTransfers.status === 'fulfilled' ? ethTransfers.value : null;
  const baseTransferValue = baseTransfers.status === 'fulfilled' ? baseTransfers.value : null;
  const ethContractTxValue = ethContractTxs.status === 'fulfilled' ? ethContractTxs.value : null;
  const baseContractTxValue = baseContractTxs.status === 'fulfilled' ? baseContractTxs.value : null;

  if (!baseScanValue) {
    warnings.push(`BaseScan holder count unavailable: ${baseScan.reason?.message || 'unknown error'}`);
  }
  if (!ethValue && !ethCounterValue) {
    warnings.push(`Ethereum holder count unavailable: ${ethInfo.reason?.message || ethCounters.reason?.message || 'unknown error'}`);
  }
  if (!baseInfoValue && !baseCounterValue) {
    warnings.push(`Base token metadata unavailable: ${baseInfo.reason?.message || baseCounters.reason?.message || 'unknown error'}`);
  }
  if (!ethCounterValue) {
    warnings.push(`Ethereum all-time transfer counter unavailable: ${ethCounters.reason?.message || 'unknown error'}`);
  }
  if (!baseCounterValue) {
    warnings.push(`Base all-time transfer counter unavailable: ${baseCounters.reason?.message || 'unknown error'}`);
  }
  if (!ethTransferValue) {
    warnings.push(`Ethereum latest CHI transfer feed unavailable: ${ethTransfers.reason?.message || 'unknown error'}`);
  }
  if (!baseTransferValue) {
    warnings.push(`Base latest CHI transfer feed unavailable: ${baseTransfers.reason?.message || 'unknown error'}`);
  }
  if (!ethContractTxValue) {
    warnings.push(`Ethereum source-wallet feed unavailable: ${ethContractTxs.reason?.message || 'unknown error'}`);
  }
  if (!baseContractTxValue) {
    warnings.push(`Base source-wallet feed unavailable: ${baseContractTxs.reason?.message || 'unknown error'}`);
  }

  let baseHolders = baseScanValue?.count ?? null;
  let baseHolderSource = baseScanValue?.source ?? null;
  let baseHolderSourceUrl = baseScanValue?.sourceUrl ?? BASESCAN_URL;

  if (baseHolders === null) {
    const fallbackBaseHolders = baseCounterValue?.holders ?? baseInfoValue?.count ?? null;

    if (Number.isFinite(fallbackBaseHolders)) {
      baseHolders = fallbackBaseHolders;
      baseHolderSource = 'Base Blockscout';
      baseHolderSourceUrl = `https://base.blockscout.com/token/${BASE_TOKEN}`;
      warnings.push('The Base holder headline is using Blockscout because BaseScan could not be read.');
    }
  }

  const ethHoldersCandidate = ethCounterValue?.holders ?? ethValue?.count ?? null;
  const ethHolders = Number.isFinite(ethHoldersCandidate)
    ? ethHoldersCandidate
    : null;

  const chainTotal = Number.isFinite(ethHolders) && Number.isFinite(baseHolders)
    ? ethHolders + baseHolders
    : null;

  const ethTransferRows = enrichTransfersWithTransactions(
    ethTransferValue?.transfers || [],
    ethContractTxValue
  );

  const baseTransferRows = enrichTransfersWithTransactions(
    baseTransferValue?.transfers || [],
    baseContractTxValue
  );

  const ethTransferTotal = Number.isFinite(ethCounterValue?.transfers)
    ? ethCounterValue.transfers
    : ethTransferRows.length;

  const baseTransferTotal = Number.isFinite(baseCounterValue?.transfers)
    ? baseCounterValue.transfers
    : baseTransferRows.length;

  const allTransferTotal = ethTransferTotal + baseTransferTotal;

  const allTransfers = [...ethTransferRows, ...baseTransferRows]
    .sort(sortTransfers)
    .slice(0, TABLE_RECORD_LIMIT);

  const latestOnChainAt = allTransfers.find(item => item.timestamp)?.timestamp || null;

  return res.status(200).json({
    ok: Boolean(baseHolders !== null || ethHolders !== null || allTransfers.length),
    fetchedAt,
    latestOnChainAt,
    refreshSeconds: 20,
    tablePageSize: 20,
    contracts: {
      ethereumToken: ETH_TOKEN,
      baseToken: BASE_TOKEN
    },
    ethereum: {
      holders: ethHolders,
      holderSource: ethValue || ethCounterValue ? 'Ethereum Blockscout' : null,
      holderSourceUrl: `https://eth.blockscout.com/token/${ETH_TOKEN}`,
      explorerUrl: ETHERSCAN_URL,
      transferExplorerUrl: ETHERSCAN_TX_URL,
      token: ethValue,
      transfers: ethTransferRows,
      transferCount: ethTransferTotal,
      visibleTransferCount: ethTransferRows.length,
      transferSource: ethTransferValue?.source || null,
      transferSourceUrl: ethTransferValue?.sourceUrl || null,
      signerSource: ethContractTxValue?.source || null,
      signerSourceUrl: ethContractTxValue?.sourceUrl || null
    },
    base: {
      holders: baseHolders,
      holderSource: baseHolderSource,
      holderSourceUrl: baseHolderSourceUrl,
      explorerUrl: BASESCAN_URL,
      token: baseInfoValue,
      transfers: baseTransferRows,
      transferCount: baseTransferTotal,
      visibleTransferCount: baseTransferRows.length,
      transferSource: baseTransferValue?.source || null,
      transferSourceUrl: baseTransferValue?.sourceUrl || null,
      signerSource: baseContractTxValue?.source || null,
      signerSourceUrl: baseContractTxValue?.sourceUrl || null,
      transferExplorerUrl: BASESCAN_URL
    },
    transactions: {
      totalCount: allTransferTotal,
      latestCount: allTransfers.length,
      pageSize: 20,
      ethereumTotalCount: ethTransferTotal,
      baseTotalCount: baseTransferTotal,
      ethereumLatestCount: ethTransferRows.length,
      baseLatestCount: baseTransferRows.length,
      label: 'All Chain Transactions',
      latestOnChainAt,
      note: 'The TXN card uses Blockscout token counters for the indexed all-time transfer total. The paginated table contains the newest combined Ethereum and Base token-transfer rows returned by Blockscout v2.',
      records: allTransfers,
      sources: [
        ethTransferValue?.source || null,
        baseTransferValue?.source || null,
        ethContractTxValue?.source || null,
        baseContractTxValue?.source || null
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
