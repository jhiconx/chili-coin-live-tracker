const API_URL = '/api/live';
const BASE_API_URL = '/api/base';
const REFRESH_MS = 20_000;
const LAST_GOOD_KEY = 'chiliTrackerLastGoodV23';

const state = {
  data: null,
  lastGood: loadLastGood(),
  loading: false,
  timer: null,
  focusWallet: '',
  direction: 'all'
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  connectionStatus: $('#connectionStatus'),
  lastUpdated: $('#lastUpdated'),
  ethHolders: $('#ethHolders'),
  baseHolders: $('#baseHolders'),
  chainTotal: $('#chainTotal'),
  allChainTransactions: $('#allChainTransactions'),
  txnSource: $('#txnSource'),
  ethHolderSource: $('#ethHolderSource'),
  baseHolderSource: $('#baseHolderSource'),
  sidebarRefresh: $('#sidebarRefresh'),
  refreshFeedback: $('#refreshFeedback'),
  activityRefresh: $('#activityRefreshButton'),
  activityRows: $('#activityRows'),
  activityStatus: $('#activityStatus'),
  activityUpdated: $('#activityUpdated'),
  transferSource: $('#transferSource'),
  walletFocusInput: $('#walletFocusInput'),
  directionFilter: $('#directionFilter'),
  clearWalletFilter: $('#clearWalletFilter')
};

function loadLastGood() {
  try {
    const raw = localStorage.getItem(LAST_GOOD_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function saveLastGood(data) {
  try {
    const hasBase = Number.isFinite(Number(data?.base?.holders)) || Number.isFinite(Number(data?.base?.transferCount)) || data?.base?.transfers?.length;
    if (hasBase) {
      localStorage.setItem(LAST_GOOD_KEY, JSON.stringify(data));
      state.lastGood = data;
    }
  } catch (_) {}
}

function formatNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '—';
}

function shortAddress(address) {
  const text = String(address || '');
  if (!/^0x[a-fA-F0-9]{40}$/.test(text)) return text || '—';
  return `${text.slice(0, 6)}…${text.slice(-4)}`;
}

function formatAmount(value) {
  if (value === null || value === undefined || value === '') return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  if (num === 0) return '0';
  if (Math.abs(num) >= 1_000_000) return num.toLocaleString('en-US', { maximumFractionDigits: 6 });
  if (Math.abs(num) >= 1) return num.toLocaleString('en-US', { maximumFractionDigits: 8 });
  return num.toLocaleString('en-US', { maximumSignificantDigits: 8 });
}

function relativeTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const diff = Date.now() - date.getTime();
  const abs = Math.abs(diff);
  const units = [
    ['year', 365 * 24 * 60 * 60 * 1000],
    ['month', 30 * 24 * 60 * 60 * 1000],
    ['day', 24 * 60 * 60 * 1000],
    ['hour', 60 * 60 * 1000],
    ['minute', 60 * 1000]
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) {
      const value = Math.round(diff / ms);
      return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(-value, unit);
    }
  }
  return 'just now';
}

function displayTime(iso) {
  if (!iso) return 'Not updated yet';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Not updated yet';
  return `Updated ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`;
}

function normalizeAddress(value) {
  const text = String(value || '').trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(text) ? text : '';
}

function bestData() {
  return state.data || state.lastGood || null;
}

function mergeGoodData(incoming) {
  const prior = state.lastGood;
  if (!prior) return incoming;
  const merged = structuredCloneSafe(incoming);
  if (!Number.isFinite(Number(merged?.base?.holders)) && Number.isFinite(Number(prior?.base?.holders))) {
    merged.base = merged.base || {};
    merged.base.holders = prior.base.holders;
    merged.base.holderSource = `${prior.base.holderSource || 'last good Base holders'} (last good)`;
  }
  if (!Number.isFinite(Number(merged?.base?.transferCount)) && Number.isFinite(Number(prior?.base?.transferCount))) {
    merged.base = merged.base || {};
    merged.base.transferCount = prior.base.transferCount;
    merged.base.transferCountSource = `${prior.base.transferCountSource || 'last good Base TXN'} (last good)`;
  }
  if ((!merged?.base?.transfers || !merged.base.transfers.length) && prior?.base?.transfers?.length) {
    merged.base = merged.base || {};
    merged.base.transfers = prior.base.transfers;
    merged.base.transferSource = `${prior.base.transferSource || 'last good Base rows'} (last good)`;
  }
  const baseCount = Number(merged?.base?.transferCount);
  const ethRows = Number(merged?.ethereum?.transfers?.length || 0);
  if (Number.isFinite(baseCount)) {
    merged.totals = merged.totals || {};
    merged.totals.allChainTransactions = baseCount + ethRows;
    merged.transactions = merged.transactions || {};
    merged.transactions.totalCount = baseCount + ethRows;
  }
  return merged;
}

function structuredCloneSafe(obj) {
  try { return structuredClone(obj); } catch (_) { return JSON.parse(JSON.stringify(obj)); }
}

async function fetchLive(force = false) {
  const response = await fetch(`${API_URL}${force ? '?force=1' : ''}`, { cache: force ? 'no-store' : 'default' });
  if (!response.ok) throw new Error(`Live API HTTP ${response.status}`);
  return response.json();
}

async function fetchBase(force = false) {
  const response = await fetch(`${BASE_API_URL}${force ? '?force=1' : ''}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Base API HTTP ${response.status}`);
  return response.json();
}

async function refresh(force = false) {
  if (state.loading) return;
  state.loading = true;
  setStatus('loading', force ? 'Refreshing…' : 'Refreshing live sources…');
  try {
    const live = await fetchLive(force);
    let data = mergeGoodData(live);

    // Base is also fetched independently. A good Base response overrides only Base values.
    try {
      const base = await fetchBase(force);
      if (base?.base) {
        data.base = { ...(data.base || {}), ...base.base };
        if (Number.isFinite(Number(base.base.transferCount))) {
          const ethRows = Number(data.ethereum?.transfers?.length || 0);
          data.totals = data.totals || {};
          data.transactions = data.transactions || {};
          data.totals.allChainTransactions = Number(base.base.transferCount) + ethRows;
          data.transactions.totalCount = Number(base.base.transferCount) + ethRows;
          data.transactions.baseTotalCount = Number(base.base.transferCount);
        }
        if (base.base.transfers?.length) {
          data.transactions = data.transactions || {};
          const ethRows = data.ethereum?.transfers || [];
          data.transactions.rows = [...base.base.transfers, ...ethRows].sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
          data.transactions.baseLoadedRows = base.base.transfers.length;
        }
      }
    } catch (baseError) {
      data.warnings = [...(data.warnings || []), `Independent Base endpoint failed: ${baseError.message}`];
    }

    state.data = data;
    saveLastGood(data);
    render();
    const warningCount = data.warnings?.length || 0;
    setStatus(warningCount ? 'warning' : 'live', warningCount ? `Live with ${warningCount} source warning${warningCount === 1 ? '' : 's'}` : 'Live');
    if (force) showFeedback('✓ Updated');
  } catch (error) {
    if (state.lastGood) {
      state.data = state.lastGood;
      render();
      setStatus('warning', 'Showing last good data');
      showFeedback('Using last good data');
    } else {
      setStatus('error', 'Live source unavailable');
      showFeedback('Refresh failed');
      renderEmpty(error.message);
    }
  } finally {
    state.loading = false;
  }
}

function setStatus(type, text) {
  if (!elements.connectionStatus) return;
  elements.connectionStatus.className = `connection-pill ${type}`;
  elements.connectionStatus.textContent = text;
}

function showFeedback(text) {
  if (!elements.refreshFeedback) return;
  elements.refreshFeedback.textContent = text;
  clearTimeout(state.feedbackTimer);
  state.feedbackTimer = setTimeout(() => { elements.refreshFeedback.textContent = ''; }, 3500);
}

function render() {
  const data = bestData();
  if (!data) return;
  const ethHolders = data.ethereum?.holders;
  const baseHolders = data.base?.holders;
  const chainTotal = Number.isFinite(Number(ethHolders)) && Number.isFinite(Number(baseHolders)) ? Number(ethHolders) + Number(baseHolders) : data.totals?.chainHolderTotal;
  const txnTotal = data.totals?.allChainTransactions ?? data.transactions?.totalCount;

  elements.ethHolders && (elements.ethHolders.textContent = formatNumber(ethHolders));
  elements.baseHolders && (elements.baseHolders.textContent = formatNumber(baseHolders));
  elements.chainTotal && (elements.chainTotal.textContent = formatNumber(chainTotal));
  elements.allChainTransactions && (elements.allChainTransactions.textContent = formatNumber(txnTotal));
  elements.ethHolderSource && (elements.ethHolderSource.textContent = data.ethereum?.holderSource || 'Ethereum source unavailable');
  elements.baseHolderSource && (elements.baseHolderSource.textContent = data.base?.holderSource || 'Base source unavailable');
  elements.txnSource && (elements.txnSource.textContent = data.transactions?.baseTotalCount ? 'All Chain Transactions' : 'TXN source partial');
  elements.lastUpdated && (elements.lastUpdated.textContent = displayTime(data.fetchedAt));
  elements.activityUpdated && (elements.activityUpdated.textContent = displayTime(data.fetchedAt));

  const sourceParts = [
    data.base?.transferSource || data.base?.transferCountSource,
    data.ethereum?.transferSource
  ].filter(Boolean);
  elements.transferSource && (elements.transferSource.textContent = sourceParts.length ? `Transfer source: ${sourceParts.join(' + ')}` : 'Transfer source: unavailable');

  renderRows(data);
}

function renderRows(data) {
  if (!elements.activityRows) return;
  const allRows = data.transactions?.rows || data.base?.transfers || [];
  const focus = normalizeAddress(state.focusWallet);
  let rows = allRows;
  if (focus) {
    rows = rows.filter(row => row.from?.toLowerCase() === focus || row.to?.toLowerCase() === focus);
    if (state.direction === 'in') rows = rows.filter(row => row.to?.toLowerCase() === focus);
    if (state.direction === 'out') rows = rows.filter(row => row.from?.toLowerCase() === focus);
  }
  rows = rows.slice(0, 300);

  const baseLoaded = Number(data.transactions?.baseLoadedRows || data.base?.transfers?.length || 0);
  const totalCount = data.transactions?.totalCount ?? data.totals?.allChainTransactions;
  if (elements.activityStatus) {
    elements.activityStatus.textContent = rows.length
      ? `Showing ${rows.length.toLocaleString()} latest rows${Number.isFinite(Number(totalCount)) ? ` of ${formatNumber(totalCount)} indexed CHI transactions` : ''}. Base rows loaded: ${baseLoaded.toLocaleString()}.`
      : 'No CHI transaction records were returned by the live sources.';
  }

  if (!rows.length) {
    elements.activityRows.innerHTML = '<tr><td colspan="7" class="empty-state">No ETH or Base CHI transfers were returned. Click Refresh TXN or open the explorer links.</td></tr>';
    return;
  }

  elements.activityRows.innerHTML = rows.map(row => {
    const chainClass = row.chainKey === 'base' ? 'base-chip' : 'eth-chip';
    const flowClass = row.event === 'Mint' ? 'in-chip' : row.event === 'Burn' ? 'out-chip' : 'transfer-chip';
    return `
      <tr>
        <td>${relativeTime(row.timestamp)}</td>
        <td><span class="chain-chip ${chainClass}">${escapeHtml(row.chain || row.chainKey || '—')}</span></td>
        <td><span class="flow-chip ${flowClass}">${escapeHtml(row.event || 'Transfer')}</span></td>
        <td><a href="${escapeAttr(row.fromUrl || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(shortAddress(row.from))}</a></td>
        <td><a href="${escapeAttr(row.toUrl || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(shortAddress(row.to))}</a></td>
        <td>${escapeHtml(formatAmount(row.amount))}</td>
        <td><a href="${escapeAttr(row.transactionUrl || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(shortAddress(row.transactionHash))} ↗</a></td>
      </tr>`;
  }).join('');
}

function renderEmpty(message) {
  elements.ethHolders && (elements.ethHolders.textContent = '—');
  elements.baseHolders && (elements.baseHolders.textContent = '—');
  elements.chainTotal && (elements.chainTotal.textContent = '—');
  elements.allChainTransactions && (elements.allChainTransactions.textContent = '—');
  elements.activityStatus && (elements.activityStatus.textContent = message || 'No live data.');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function setupEvents() {
  elements.sidebarRefresh?.addEventListener('click', () => refresh(true));
  elements.activityRefresh?.addEventListener('click', () => refresh(true));
  elements.walletFocusInput?.addEventListener('input', event => {
    state.focusWallet = event.target.value;
    renderRows(bestData() || {});
  });
  elements.directionFilter?.addEventListener('change', event => {
    state.direction = event.target.value;
    renderRows(bestData() || {});
  });
  elements.clearWalletFilter?.addEventListener('click', () => {
    state.focusWallet = '';
    state.direction = 'all';
    if (elements.walletFocusInput) elements.walletFocusInput.value = '';
    if (elements.directionFilter) elements.directionFilter.value = 'all';
    renderRows(bestData() || {});
  });
}

setupEvents();
if (state.lastGood) {
  state.data = state.lastGood;
  render();
  setStatus('warning', 'Showing last good data');
}
refresh(false);
state.timer = setInterval(() => refresh(false), REFRESH_MS);
