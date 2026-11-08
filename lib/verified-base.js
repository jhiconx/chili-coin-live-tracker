const TOKEN = '0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const PROVIDERS = ['https://base-rpc.publicnode.com', 'https://mainnet.base.org'];
const CHUNK = 9000;
const LOOKBACK = 180000;
const MAX_ROWS = 60;

async function rpc(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8500),
    cache: 'no-store'
  });
  if (!response.ok) throw new Error('RPC HTTP ' + response.status);
  const json = await response.json();
  if (Array.isArray(payload)) {
    if (!Array.isArray(json)) throw new Error('RPC did not return a batch');
    const byId = new Map(json.map(item => [item.id, item]));
    return payload.map(item => {
      const result = byId.get(item.id);
      if (!result || result.error || !result.result) throw new Error('RPC block batch incomplete');
      return result.result;
    });
  }
  if (json.error || !Object.prototype.hasOwnProperty.call(json, 'result')) {
    throw new Error('RPC error ' + String(json.error?.message || 'unknown'));
  }
  return json.result;
}

const call = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });
const hex = value => '0x' + value.toString(16);

export function normalizeTransferLog(log, timestamp) {
  if (!log || log.address?.toLowerCase() !== TOKEN.toLowerCase() ||
      log.topics?.length !== 3 || log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC ||
      !/^0x[0-9a-fA-F]{64}$/.test(log.transactionHash || '') ||
      !/^0x[0-9a-fA-F]{64}$/.test(log.data || '') ||
      !/^0x[0-9a-fA-F]{64}$/.test(log.topics[1] || '') ||
      !/^0x[0-9a-fA-F]{64}$/.test(log.topics[2] || '') ||
      !Number.isInteger(timestamp) || timestamp <= 0) return null;
  const value = BigInt(log.data);
  if (value < 0n) return null;
  return {
    hash: log.transactionHash.toLowerCase(),
    from: '0x' + log.topics[1].slice(-40).toLowerCase(),
    to: '0x' + log.topics[2].slice(-40).toLowerCase(),
    value: value.toString(),
    tokenDecimal: 18,
    timeStamp: timestamp,
    blockNumber: Number(BigInt(log.blockNumber)),
    contractAddress: TOKEN,
    logIndex: Number(BigInt(log.logIndex)),
    sourceName: 'Base RPC verified CHI Transfer logs'
  };
}

async function collect(url) {
  const chainId = await rpc(url, call(1, 'eth_chainId', []));
  if (Number(BigInt(chainId)) !== 8453) throw new Error('RPC is not Base mainnet');
  const latest = Number(BigInt(await rpc(url, call(2, 'eth_blockNumber', []))));
  const oldest = Math.max(0, latest - LOOKBACK);
  const logs = [];
  let id = 3;

  for (let end = latest; end >= oldest && logs.length < 90; end -= CHUNK) {
    const start = Math.max(oldest, end - CHUNK + 1);
    const items = await rpc(url, call(id++, 'eth_getLogs', [{
      address: TOKEN,
      fromBlock: hex(start),
      toBlock: hex(end),
      topics: [TRANSFER_TOPIC]
    }]));
    if (!Array.isArray(items)) throw new Error('RPC event logs malformed');
    logs.push(...items);
  }
  if (!logs.length) return [];

  const ordered = logs.sort((a, b) =>
    Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)) ||
    Number(BigInt(b.logIndex) - BigInt(a.logIndex))
  ).slice(0, MAX_ROWS);

  const blocks = [...new Set(ordered.map(log => log.blockNumber))];
  const headers = await rpc(url,
    blocks.map((number, index) => call(index + 1000, 'eth_getBlockByNumber', [number, false])));
  const times = new Map(headers.map((block, i) => [
    blocks[i], Number(BigInt(block.timestamp))
  ]));
  const rows = ordered
    .map(log => normalizeTransferLog(log, times.get(log.blockNumber)))
    .filter(Boolean);

  if (rows.length !== ordered.length) throw new Error('RPC log validation failed');
  return rows;
}

/** Public Base RPC data only; no wallet keys, Circle API, or customer data. */
export async function fetchVerifiedBaseTransferRows() {
  const problems = [];
  for (const endpoint of PROVIDERS) {
    try {
      const rows = await collect(endpoint);
      if (rows.length) return rows;
      problems.push(endpoint + ': no CHI logs in lookback');
    } catch (error) {
      problems.push(endpoint + ': ' + String(error.message).slice(0,100));
    }
  }
  throw new Error('Verified Base CHI feed unavailable: ' + problems.join(' | '));
}
