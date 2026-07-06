const API_URL = '/api/live';
const BASESCAN_TX_URL = 'https://basescan.org/token/0x65aa05778b093ea8f3ecdaff6f070a30eb15c3d3?a=0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8#transactions';
const REFRESH_MS = 20_000;

const state = {
  data: null,
  loading: false,
  query: '',
  timer: null
};

const elements = {
  connectionStatus: document.querySelector('#connectionStatus'),
  lastUpdated: document.querySelector('#lastUpdated'),
  ethHolders: document.querySelector('#ethHolders'),
  baseHolders: document.querySelector('#baseHolders'),
  chainTotal: document.querySelector('#chainTotal'),
  activity24h: document.querySelector('#activity24h'),
  activityNote: document.querySelector('#activityNote'),
  baseHolderSource: document.querySelector('#baseHolderSource'),
  rows: document.querySelector('#activityRows'),
  transferSource: document.querySelector('#transferSource'),
  search: document.querySelector('#activitySearch'),
  refresh: document.querySelector('#refreshButton'),
  sidebarRefresh: document.querySelector('#sidebarRefresh'),
  allTransactionsLink: document.querySelector('#allTransactionsLink')
};

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('en-US') : '—';
}

function shortHash(value, start = 7, end = 5) {
  if (!value) return '—';
  const text = String(value);
  return text.length > start + end + 1 ? `${text.slice(0, start)}…${text.slice(-end)}` : text;
}

function normalizeTimestamp(value) {
  if (!value) return null;
  if (/^\d+$/.test(String(value))) return new Date(Number(value) * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function relativeTime(value) {
  const date = normalizeTimestamp(value);
  if (!date) return 'Time unavailable';
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const ranges = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
    ['second', 1]
  ];
  for (const [unit, size] of ranges) {
    if (Math.abs(seconds) >= size || unit === 'second') return formatter.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setConnection(type, text) {
  elements.connectionStatus.className = `connection-pill ${type}`;
  elements.connectionStatus.textContent = text;
}

function eventClass(direction) {
  return String(direction || 'transfer').toLowerCase();
}

function renderMetrics(data) {
  elements.ethHolders.textContent = formatNumber(data.ethereum?.holders);
  elements.baseHolders.textContent = formatNumber(data.base?.holders);
  elements.chainTotal.textContent = formatNumber(data.chainTotal);
  elements.activity24h.textContent = formatNumber(data.base?.activity24h);
  elements.baseHolderSource.textContent = data.base?.holderSource || 'Source unavailable';

  if (data.base?.activity24h === null || data.base?.activity24h === undefined) {
    elements.activityNote.innerHTML = '<i class="status-bullet red"></i>Transfer feed unavailable';
  } else if (data.base?.activity24hComplete) {
    elements.activityNote.innerHTML = '<i class="status-bullet green"></i>Indexed transfers in the last 24 hours';
  } else {
    elements.activityNote.innerHTML = '<i class="status-bullet amber"></i>Minimum indexed activity; feed pagination limit reached';
  }
}

function filteredTransfers() {
  const transfers = state.data?.base?.transfers || [];
  const query = state.query.trim().toLowerCase();
  if (!query) return transfers;
  return transfers.filter(item => [
    item.transactionHash,
    item.counterparty,
    item.from,
    item.to,
    item.direction,
    item.tokenId,
    item.amount
  ].some(value => String(value || '').toLowerCase().includes(query)));
}

function renderActivity() {
  const transfers = filteredTransfers();
  if (!transfers.length) {
    const message = state.query ? 'No live Base activity matches that search.' : 'No indexed Base transfers were returned by the live source.';
    elements.rows.innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHtml(message)}</td></tr>`;
    return;
  }

  elements.rows.innerHTML = transfers.map(item => {
    const tx = item.transactionHash || '';
    const counterparty = item.counterparty || '';
    const time = relativeTime(item.timestamp);
    const direction = item.direction || 'Transfer';
    const txLink = tx ? `https://basescan.org/tx/${encodeURIComponent(tx)}` : BASESCAN_TX_URL;
    const walletLink = counterparty ? `https://basescan.org/address/${encodeURIComponent(counterparty)}` : BASESCAN_TX_URL;
    return `
      <tr>
        <td title="${escapeHtml(item.timestamp || '')}">${escapeHtml(time)}</td>
        <td><span class="event-tag ${eventClass(direction)}">${escapeHtml(direction)}</span></td>
        <td><a class="mono-link" href="${walletLink}" target="_blank" rel="noopener" title="${escapeHtml(counterparty)}">${escapeHtml(shortHash(counterparty))}</a></td>
        <td>${escapeHtml(item.tokenId ?? '—')}</td>
        <td>${escapeHtml(item.amount ?? '—')}</td>
        <td><a class="mono-link" href="${txLink}" target="_blank" rel="noopener" title="${escapeHtml(tx)}">${escapeHtml(shortHash(tx, 9, 6))} ↗</a></td>
      </tr>`;
  }).join('');
}

function renderSources(data) {
  const transferSource = data.base?.transferSource || 'Unavailable';
  elements.transferSource.textContent = `Transfer source: ${transferSource}`;
  elements.allTransactionsLink.href = data.base?.baseScanUrl || BASESCAN_TX_URL;
}

function renderStatus(data) {
  const warnings = Array.isArray(data.warnings) ? data.warnings : [];
  if (!data.ok) {
    setConnection('bad', 'Live sources unavailable');
  } else if (warnings.length) {
    setConnection('warn', `Live with ${warnings.length} source warning${warnings.length === 1 ? '' : 's'}`);
  } else {
    setConnection('good', 'Live sources connected');
  }
  const fetched = normalizeTimestamp(data.fetchedAt);
  elements.lastUpdated.textContent = fetched
    ? `Updated ${fetched.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`
    : 'Update time unavailable';
}

async function loadLiveData({ manual = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  elements.refresh.disabled = true;
  elements.refresh.textContent = '↻ Refreshing';
  if (manual || !state.data) setConnection('loading', 'Refreshing live sources…');

  try {
    const response = await fetch(`${API_URL}?t=${Date.now()}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`Live endpoint returned HTTP ${response.status}`);
    const data = await response.json();
    state.data = data;
    renderMetrics(data);
    renderActivity();
    renderSources(data);
    renderStatus(data);
  } catch (error) {
    setConnection('bad', 'Live connection failed');
    elements.lastUpdated.textContent = error.message;
    if (!state.data) {
      elements.rows.innerHTML = '<tr><td colspan="6" class="empty-state">The live endpoint could not be reached. Deploy this folder on Vercel so the <code>/api/live</code> serverless route is available.</td></tr>';
    }
  } finally {
    state.loading = false;
    elements.refresh.disabled = false;
    elements.refresh.textContent = '↻ Refresh';
  }
}

function scheduleRefresh() {
  clearInterval(state.timer);
  state.timer = setInterval(() => loadLiveData(), REFRESH_MS);
}

elements.search.addEventListener('input', event => {
  state.query = event.target.value;
  renderActivity();
});
elements.refresh.addEventListener('click', () => loadLiveData({ manual: true }));
elements.sidebarRefresh.addEventListener('click', () => loadLiveData({ manual: true }));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadLiveData();
});

loadLiveData();
scheduleRefresh();
