const API_URL = '/api/live';
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
  refreshFeedback: document.querySelector('#refreshFeedback')
};

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('en-US') : '—';
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function setConnection(type, text) {
  elements.connectionStatus.className = `connection-pill ${type}`;
  elements.connectionStatus.textContent = text;
}

function setRefreshButton({ loading = false, success = false, error = false } = {}) {
  clearTimeout(state.feedbackTimer);
  elements.sidebarRefresh.disabled = loading;

  if (loading) {
    elements.sidebarRefresh.textContent = 'Refreshing…';
    elements.refreshFeedback.textContent = 'Requesting current holder totals.';
    return;
  }

  if (success) {
    elements.sidebarRefresh.textContent = '✓ Updated';
    elements.refreshFeedback.textContent = 'Live totals refreshed.';
    state.feedbackTimer = setTimeout(() => {
      elements.sidebarRefresh.textContent = 'Refresh now';
      elements.refreshFeedback.textContent = '';
    }, 2200);
    return;
  }

  if (error) {
    elements.sidebarRefresh.textContent = 'Try again';
    elements.refreshFeedback.textContent = 'Refresh failed. The automatic refresh will retry.';
    state.feedbackTimer = setTimeout(() => {
      elements.sidebarRefresh.textContent = 'Refresh now';
    }, 3500);
    return;
  }

  elements.sidebarRefresh.textContent = 'Refresh now';
  elements.refreshFeedback.textContent = '';
}

function renderMetrics(data) {
  elements.ethHolders.textContent = formatNumber(data.ethereum?.holders);
  elements.baseHolders.textContent = formatNumber(data.base?.holders);
  elements.chainTotal.textContent = formatNumber(data.chainTotal);
  elements.ethHolderSource.textContent = data.ethereum?.holderSource || 'Ethereum source unavailable';
  elements.baseHolderSource.textContent = data.base?.holderSource || 'Base source unavailable';
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
    renderStatus(data);
    if (manual) setRefreshButton({ success: true });
  } catch (error) {
    setConnection('bad', 'Live connection failed');
    elements.lastUpdated.textContent = error instanceof Error ? error.message : 'Unknown refresh error';
    if (manual) setRefreshButton({ error: true });
  } finally {
    state.loading = false;
    if (!manual) elements.sidebarRefresh.disabled = false;
  }
}

function scheduleRefresh() {
  clearInterval(state.timer);
  state.timer = setInterval(() => loadLiveData(), REFRESH_MS);
}

elements.sidebarRefresh.addEventListener('click', () => loadLiveData({ manual: true }));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadLiveData();
});

loadLiveData();
scheduleRefresh();
