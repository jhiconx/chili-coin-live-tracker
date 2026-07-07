const API_URL = '/api/live';
const BASESCAN_TX_URL = 'https://basescan.org/token/0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8#transactions';
const REFRESH_MS = 20_000;

const state = {
  data: null,
  loading: false,
  timer: null,
  feedbackTimer: null
};

const elements = {
  connectionStatus: document.querySelector('#connectionStatus'),
  lastUpdated: document.querySelector('#lastUpdated'),
  ethHolders: document.querySelector('#ethHolders'),
  baseHolders: document.querySelector('#baseHolders'),
  chainTotal: document.querySelector('#chainTotal'),
  ethHolderSource: document.querySelector('#ethHolderSource'),
  baseHolderSource: document.querySelector('#baseHolderSource'),
  sidebarRefresh: document.querySelector('#sidebarRefresh'),
  refreshFeedback: document.querySelector('#refreshFeedback'),
  activityRefresh: document.querySelector('#activityRefreshButton'),
  activityRows: document.querySelector('#activityRows'),
  activityStatus: document.querySelector('#activityStatus'),
  activityUpdated: document.querySelector('#activityUpdated'),
  transferSource: document.querySelector('#transferSource'),
  allTransactionsLink: document.querySelector('#allTransactionsLink')
};

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('en-US') : '—';
}

function formatDecimalString(value) {
  if (value === null || value === undefined || value === '') return '—';
  const [whole, fraction = ''] = String(value).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function shortHash(value, start = 7, end = 5) {
  if (!value) return '—';
  const text = String(value);
  return text.length > start + end + 1 ? `${text.slice(0, start)}…${text.slice(-end)}` : text;
}

function normalizeTimestamp(value) {
  if (!value) return null;
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

function setRefreshButton({ loading = false, success = false, error = false } = {}) {
  clearTimeout(state.feedbackTimer);
  elements.sidebarRefresh.disabled = loading;
  if (elements.activityRefresh) elements.activityRefresh.disabled = loading;

  if (loading) {
    elements.sidebarRefresh.textContent = 'Refreshing…';
    if (elements.activityRefresh) elements.activityRefresh.textContent = '↻ Refreshing…';
    elements.refreshFeedback.textContent = 'Requesting current holder totals and Base transfers.';
    return;
  }

  if (success) {
    elements.sidebarRefresh.textContent = '✓ Updated';
    if (elements.activityRefresh) elements.activityRefresh.textContent = '✓ Activity updated';
    elements.refreshFeedback.textContent = 'Live data refreshed.';
    state.feedbackTimer = setTimeout(() => {
      elements.sidebarRefresh.textContent = 'Refresh now';
      if (elements.activityRefresh) elements.activityRefresh.textContent = '↻ Refresh activity';
      elements.refreshFeedback.textContent = '';
    }, 2200);
    return;
  }

  if (error) {
    elements.sidebarRefresh.textContent = 'Try again';
    if (elements.activityRefresh) elements.activityRefresh.textContent = 'Try activity again';
    elements.refreshFeedback.textContent = 'Refresh failed. The automatic refresh will retry.';
    state.feedbackTimer = setTimeout(() => {
      elements.sidebarRefresh.textContent = 'Refresh now';
      if (elements.activityRefresh) elements.activityRefresh.textContent = '↻ Refresh activity';
    }, 3500);
    return;
  }

  elements.sidebarRefresh.textContent = 'Refresh now';
  if (elements.activityRefresh) elements.activityRefresh.textContent = '↻ Refresh activity';
  elements.refreshFeedback.textContent = '';
}

function renderMetrics(data) {
  elements.ethHolders.textContent = formatNumber(data.ethereum?.holders);
  elements.baseHolders.textContent = formatNumber(data.base?.holders);
  elements.chainTotal.textContent = formatNumber(data.chainTotal);
  elements.ethHolderSource.textContent = data.ethereum?.holderSource || 'Ethereum source unavailable';
  elements.baseHolderSource.textContent = data.base?.holderSource || 'Base source unavailable';
}

function eventClass(event) {
  return String(event || 'transfer').toLowerCase();
}

function renderActivity(data) {
  if (!elements.activityRows) return;
  const transfers = Array.isArray(data.base?.transfers) ? data.base.transfers : [];
  const fetched = normalizeTimestamp(data.fetchedAt);

  elements.transferSource.textContent = `Transfer source: ${data.base?.transferSource || 'Unavailable'}`;
  elements.allTransactionsLink.href = data.base?.transferExplorerUrl || BASESCAN_TX_URL;
  elements.activityUpdated.textContent = fetched
    ? `Updated ${fetched.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`
    : 'Update time unavailable';

  if (!transfers.length) {
    elements.activityStatus.textContent = 'No transfer records were returned by the live source.';
    elements.activityRows.innerHTML = '<tr><td colspan="6" class="empty-state">No Base CHI transfers were returned. Use “Refresh activity” to retry, or open BaseScan to verify the explorer feed.</td></tr>';
    return;
  }

  elements.activityStatus.textContent = `Showing the latest ${transfers.length} indexed Base CHI transfer${transfers.length === 1 ? '' : 's'}.`;
  elements.activityRows.innerHTML = transfers.map(item => {
    const tx = item.transactionHash || '';
    const from = item.from || '';
    const to = item.to || '';
    const event = item.event || 'Transfer';
    const txLink = tx ? `https://basescan.org/tx/${encodeURIComponent(tx)}` : BASESCAN_TX_URL;
    const fromLink = from ? `https://basescan.org/address/${encodeURIComponent(from)}` : BASESCAN_TX_URL;
    const toLink = to ? `https://basescan.org/address/${encodeURIComponent(to)}` : BASESCAN_TX_URL;
    return `
      <tr>
        <td title="${escapeHtml(item.timestamp || '')}">${escapeHtml(relativeTime(item.timestamp))}</td>
        <td><span class="event-tag ${eventClass(event)}">${escapeHtml(event)}</span></td>
        <td><a class="mono-link" href="${fromLink}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(from)}">${escapeHtml(shortHash(from))}</a></td>
        <td><a class="mono-link" href="${toLink}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(to)}">${escapeHtml(shortHash(to))}</a></td>
        <td class="amount-cell">${escapeHtml(formatDecimalString(item.amount))}</td>
        <td><a class="mono-link" href="${txLink}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(tx)}">${escapeHtml(shortHash(tx, 9, 6))} ↗</a></td>
      </tr>`;
  }).join('');
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
  if (manual) setRefreshButton({ loading: true });
  if (manual || !state.data) setConnection('loading', 'Refreshing live sources…');
  if (elements.activityStatus && manual) elements.activityStatus.textContent = 'Refreshing Base CHI transfers…';

  try {
    const params = new URLSearchParams({ t: String(Date.now()) });
    if (manual) params.set('force', '1');

    const response = await fetch(`${API_URL}?${params.toString()}`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'cache-control': 'no-cache'
      },
      cache: 'no-store'
    });

    if (!response.ok) throw new Error(`Live endpoint returned HTTP ${response.status}`);
    const data = await response.json();
    state.data = data;
    renderMetrics(data);
    renderActivity(data);
    renderStatus(data);
    if (manual) setRefreshButton({ success: true });
  } catch (error) {
    setConnection('bad', 'Live connection failed');
    elements.lastUpdated.textContent = error instanceof Error ? error.message : 'Unknown refresh error';
    if (elements.activityStatus) elements.activityStatus.textContent = 'Base CHI transfer refresh failed.';
    if (!state.data && elements.activityRows) {
      elements.activityRows.innerHTML = '<tr><td colspan="6" class="empty-state">The live endpoint could not be reached. Vercel will retry on the next automatic refresh.</td></tr>';
    }
    if (manual) setRefreshButton({ error: true });
  } finally {
    state.loading = false;
    if (!manual) {
      elements.sidebarRefresh.disabled = false;
      if (elements.activityRefresh) elements.activityRefresh.disabled = false;
    }
  }
}

function scheduleRefresh() {
  clearInterval(state.timer);
  state.timer = setInterval(() => loadLiveData(), REFRESH_MS);
}

elements.sidebarRefresh.addEventListener('click', () => loadLiveData({ manual: true }));
if (elements.activityRefresh) {
  elements.activityRefresh.addEventListener('click', () => loadLiveData({ manual: true }));
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadLiveData();
});

loadLiveData();
scheduleRefresh();
