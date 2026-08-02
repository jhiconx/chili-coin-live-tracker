const API_URL = '/api/live';
const BASESCAN_TX_URL = 'https://basescan.org/token/0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8#transactions';
const ETHERSCAN_TX_URL = 'https://etherscan.io/token/0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA#tokentxns';
const REFRESH_MS = 20_000;

const state = {
  data: null,
  loading: false,
  timer: null,
  feedbackTimer: null,
  focusWallet: '',
  direction: 'all',
  activityPage: 1,
  activityPageSize: 20
};

const elements = {
  connectionStatus: document.querySelector('#connectionStatus'),
  lastUpdated: document.querySelector('#lastUpdated'),
  ethHolders: document.querySelector('#ethHolders'),
  baseHolders: document.querySelector('#baseHolders'),
  chainTotal: document.querySelector('#chainTotal'),
  allChainTransactions: document.querySelector('#allChainTransactions'),
  txnSource: document.querySelector('#txnSource'),
  ethHolderSource: document.querySelector('#ethHolderSource'),
  baseHolderSource: document.querySelector('#baseHolderSource'),
  sidebarRefresh: document.querySelector('#sidebarRefresh'),
  refreshFeedback: document.querySelector('#refreshFeedback'),
  activityRefresh: document.querySelector('#activityRefreshButton'),
  activityRows: document.querySelector('#activityRows'),
  activityStatus: document.querySelector('#activityStatus'),
  activityUpdated: document.querySelector('#activityUpdated'),
  activityPagination: document.querySelector('#activityPagination'),
  transferSource: document.querySelector('#transferSource'),
  baseTransactionsLink: document.querySelector('#baseTransactionsLink'),
  ethTransactionsLink: document.querySelector('#ethTransactionsLink'),
  walletFocusInput: document.querySelector('#walletFocusInput'),
  directionFilter: document.querySelector('#directionFilter'),
  clearWalletFilter: document.querySelector('#clearWalletFilter')
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

function normalizeAddress(value) {
  const text = String(value || '').trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(text) ? text : '';
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
    elements.refreshFeedback.textContent = 'Requesting current holder totals and CHI transaction flow.';
    return;
  }

  if (success) {
    elements.sidebarRefresh.textContent = '✓ Updated';
    if (elements.activityRefresh) elements.activityRefresh.textContent = '✓ TXN updated';
    elements.refreshFeedback.textContent = 'Live data refreshed.';
    state.feedbackTimer = setTimeout(() => {
      elements.sidebarRefresh.textContent = 'Refresh now';
      if (elements.activityRefresh) elements.activityRefresh.textContent = '↻ Refresh TXN';
      elements.refreshFeedback.textContent = '';
    }, 2200);
    return;
  }

  if (error) {
    elements.sidebarRefresh.textContent = 'Try again';
    if (elements.activityRefresh) elements.activityRefresh.textContent = 'Try TXN again';
    elements.refreshFeedback.textContent = 'Refresh failed. The automatic refresh will retry.';
    state.feedbackTimer = setTimeout(() => {
      elements.sidebarRefresh.textContent = 'Refresh now';
      if (elements.activityRefresh) elements.activityRefresh.textContent = '↻ Refresh TXN';
    }, 3500);
    return;
  }

  elements.sidebarRefresh.textContent = 'Refresh now';
  if (elements.activityRefresh) elements.activityRefresh.textContent = '↻ Refresh TXN';
  elements.refreshFeedback.textContent = '';
}

function renderMetrics(data) {
  elements.ethHolders.textContent = formatNumber(data.ethereum?.holders);
  elements.baseHolders.textContent = formatNumber(data.base?.holders);
  elements.chainTotal.textContent = formatNumber(data.chainTotal);
  if (elements.allChainTransactions) elements.allChainTransactions.textContent = formatNumber(data.transactions?.totalCount ?? data.transactions?.latestCount);
  if (elements.txnSource) elements.txnSource.textContent = data.transactions?.label || 'All Chain Transactions';
  elements.ethHolderSource.textContent = data.ethereum?.holderSource || 'Ethereum source unavailable';
  elements.baseHolderSource.textContent = data.base?.holderSource || 'Base source unavailable';
}

function eventClass(event) {
  return String(event || 'transfer').toLowerCase();
}

function chainClass(chainKey) {
  return String(chainKey || '').toLowerCase() === 'base' ? 'base' : 'ethereum';
}

function flowForTransfer(item, focusWallet) {
  const from = String(item.from || '').toLowerCase();
  const to = String(item.to || '').toLowerCase();
  const sourceWallet = String(item.sourceWallet || item.transactionInitiator || '').toLowerCase();
  if (focusWallet) {
    if (from === focusWallet && to === focusWallet) return 'Self';
    if (to === focusWallet) return 'In';
    if (from === focusWallet || sourceWallet === focusWallet) return 'Out';
    return 'Other';
  }
  return item.event || 'Transfer';
}

function flowClass(flow) {
  return String(flow || 'transfer').toLowerCase();
}

function allTransferRecords(data) {
  if (Array.isArray(data.transactions?.records)) return data.transactions.records;
  return [
    ...(Array.isArray(data.ethereum?.transfers) ? data.ethereum.transfers : []),
    ...(Array.isArray(data.base?.transfers) ? data.base.transfers : [])
  ];
}

function filteredTransfers(data) {
  const focusWallet = normalizeAddress(state.focusWallet);
  const direction = state.direction;
  let rows = allTransferRecords(data);

  if (focusWallet) {
    rows = rows.filter(item => {
      const flow = flowForTransfer(item, focusWallet).toLowerCase();
      if (flow === 'other') return false;
      if (direction === 'in') return flow === 'in';
      if (direction === 'out') return flow === 'out';
      return true;
    });
  }

  return rows;
}

function paginationItems(currentPage, totalPages) {
  if (totalPages <= 8) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set([
    1,
    2,
    currentPage - 1,
    currentPage,
    currentPage + 1,
    totalPages - 1,
    totalPages
  ]);

  return [...pages]
    .filter(page => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);
}

function renderActivityPagination(totalRows) {
  if (!elements.activityPagination) return;

  const pageSize = state.activityPageSize;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  state.activityPage = Math.min(Math.max(1, state.activityPage), totalPages);

  const pages = paginationItems(state.activityPage, totalPages);
  const parts = [
    `<button class="activity-page-button direction" type="button" data-page="${state.activityPage - 1}" ${state.activityPage === 1 ? 'disabled' : ''}>← Previous</button>`
  ];

  let priorPage = 0;

  for (const page of pages) {
    if (priorPage && page - priorPage > 1) {
      parts.push('<span class="activity-page-ellipsis" aria-hidden="true">…</span>');
    }

    parts.push(
      `<button class="activity-page-button ${page === state.activityPage ? 'active' : ''}" type="button" data-page="${page}" aria-label="Transaction page ${page}" ${page === state.activityPage ? 'aria-current="page"' : ''}>${page}</button>`
    );

    priorPage = page;
  }

  parts.push(
    `<button class="activity-page-button direction" type="button" data-page="${state.activityPage + 1}" ${state.activityPage === totalPages ? 'disabled' : ''}>Next →</button>`
  );

  elements.activityPagination.innerHTML = parts.join('');

  elements.activityPagination
    .querySelectorAll('button[data-page]')
    .forEach(button => {
      button.addEventListener('click', () => {
        const requestedPage = Number(button.dataset.page);
        if (!Number.isInteger(requestedPage)) return;

        state.activityPage = Math.min(Math.max(1, requestedPage), totalPages);
        renderActivity(state.data);

        document.querySelector('#activity')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      });
    });
}

function renderActivity(data) {
  if (!elements.activityRows) return;

  const transfers = filteredTransfers(data);
  const totalLoaded = allTransferRecords(data).length;
  const fetched = normalizeTimestamp(data.fetchedAt);
  const latestOnChain = normalizeTimestamp(
    data.transactions?.latestOnChainAt
      || data.latestOnChainAt
      || allTransferRecords(data)[0]?.timestamp
  );

  const ethCount = data.transactions?.ethereumTotalCount
    ?? data.ethereum?.transferCount
    ?? data.transactions?.ethereumLatestCount
    ?? 0;

  const baseCount = data.transactions?.baseTotalCount
    ?? data.base?.transferCount
    ?? data.transactions?.baseLatestCount
    ?? 0;

  const focusWallet = normalizeAddress(state.focusWallet);

  elements.transferSource.textContent =
    `Transfer source: ETH ${formatNumber(ethCount)} + Base ${formatNumber(baseCount)} all-time indexed transfers`;

  if (elements.baseTransactionsLink) {
    elements.baseTransactionsLink.href =
      data.transactions?.explorerLinks?.base || BASESCAN_TX_URL;
  }

  if (elements.ethTransactionsLink) {
    elements.ethTransactionsLink.href =
      data.transactions?.explorerLinks?.ethereum || ETHERSCAN_TX_URL;
  }

  const fetchedText = fetched
    ? `Updated ${fetched.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit'
    })}`
    : 'Update time unavailable';

  const latestText = latestOnChain
    ? `Latest record ${latestOnChain.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })}`
    : 'Latest record unavailable';

  elements.activityUpdated.textContent = `${fetchedText} · ${latestText}`;

  if (!totalLoaded) {
    elements.activityStatus.textContent =
      'No CHI transaction records were returned by the live sources.';

    elements.activityRows.innerHTML =
      '<tr><td colspan="8" class="empty-state">No ETH or Base CHI transfers were returned. Use “Refresh TXN” to retry, or open the explorer links below.</td></tr>';

    if (elements.activityPagination) elements.activityPagination.innerHTML = '';
    return;
  }

  if (!transfers.length) {
    const message = focusWallet
      ? 'No CHI in/out transfers matched that wallet in the latest loaded records.'
      : 'No CHI transfers matched the selected filter.';

    elements.activityStatus.textContent = message;
    elements.activityRows.innerHTML =
      `<tr><td colspan="8" class="empty-state">${escapeHtml(message)}</td></tr>`;

    if (elements.activityPagination) elements.activityPagination.innerHTML = '';
    return;
  }

  const pageSize = state.activityPageSize;
  const totalPages = Math.max(1, Math.ceil(transfers.length / pageSize));
  state.activityPage = Math.min(Math.max(1, state.activityPage), totalPages);

  const startIndex = (state.activityPage - 1) * pageSize;
  const pageTransfers = transfers.slice(startIndex, startIndex + pageSize);
  const firstShown = startIndex + 1;
  const lastShown = startIndex + pageTransfers.length;

  const focusText = focusWallet
    ? ` for ${shortHash(focusWallet, 8, 6)}`
    : '';

  elements.activityStatus.textContent =
    `Showing records ${firstShown}–${lastShown} of ${formatNumber(transfers.length)} loaded latest CHI transfers${focusText}. Page ${state.activityPage} of ${totalPages}. The TXN card reflects ${formatNumber(data.transactions?.totalCount ?? totalLoaded)} all-time indexed transfer events.`;

  elements.activityRows.innerHTML = pageTransfers.map(item => {
    const tx = item.transactionHash || '';
    const from = item.from || '';
    const to = item.to || '';
    const flow = flowForTransfer(item, focusWallet);

    const txLink = item.transactionUrl
      || (item.chainKey === 'ethereum'
        ? `https://etherscan.io/tx/${tx}`
        : `https://basescan.org/tx/${tx}`);

    const sourceWallet =
      item.sourceWallet || item.transactionInitiator || from;

    const sourceLink = item.sourceWalletUrl
      || (item.chainKey === 'ethereum'
        ? `https://etherscan.io/address/${sourceWallet}`
        : `https://basescan.org/address/${sourceWallet}`);

    const fromLink = item.fromUrl
      || (item.chainKey === 'ethereum'
        ? `https://etherscan.io/address/${from}`
        : `https://basescan.org/address/${from}`);

    const toLink = item.toUrl
      || (item.chainKey === 'ethereum'
        ? `https://etherscan.io/address/${to}`
        : `https://basescan.org/address/${to}`);

    return `
      <tr>
        <td title="${escapeHtml(item.timestamp || '')}">${escapeHtml(relativeTime(item.timestamp))}</td>
        <td><span class="chain-pill ${chainClass(item.chainKey)}">${escapeHtml(item.chain || 'Chain')}</span></td>
        <td><span class="flow-tag ${flowClass(flow)}">${escapeHtml(flow)}</span></td>
        <td><a class="mono-link" href="${sourceLink}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(sourceWallet)}">${escapeHtml(shortHash(sourceWallet))}</a></td>
        <td><a class="mono-link" href="${fromLink}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(from)}">${escapeHtml(shortHash(from))}</a></td>
        <td><a class="mono-link" href="${toLink}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(to)}">${escapeHtml(shortHash(to))}</a></td>
        <td class="amount-cell">${escapeHtml(formatDecimalString(item.amount))}</td>
        <td><a class="mono-link" href="${txLink}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(tx)}">${escapeHtml(shortHash(tx, 9, 6))} ↗</a></td>
      </tr>`;
  }).join('');

  renderActivityPagination(transfers.length);
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
  if (elements.activityStatus && manual) elements.activityStatus.textContent = 'Refreshing all-chain CHI transactions…';

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
    const firstLoad = !state.data;
    state.data = data;
    if (manual || firstLoad) state.activityPage = 1;
    renderMetrics(data);
    renderActivity(data);
    renderStatus(data);
    if (manual) setRefreshButton({ success: true });
  } catch (error) {
    setConnection('bad', 'Live connection failed');
    elements.lastUpdated.textContent = error instanceof Error ? error.message : 'Unknown refresh error';
    if (elements.activityStatus) elements.activityStatus.textContent = 'CHI transaction refresh failed.';
    if (!state.data && elements.activityRows) {
      elements.activityRows.innerHTML = '<tr><td colspan="8" class="empty-state">The live endpoint could not be reached. Vercel will retry on the next automatic refresh.</td></tr>';
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

function rerenderActivityFromControls() {
  if (!state.data) return;
  state.focusWallet = elements.walletFocusInput?.value || '';
  state.direction = elements.directionFilter?.value || 'all';
  state.activityPage = 1;
  renderActivity(state.data);
}

elements.sidebarRefresh.addEventListener('click', () => loadLiveData({ manual: true }));
if (elements.activityRefresh) {
  elements.activityRefresh.addEventListener('click', () => loadLiveData({ manual: true }));
}
if (elements.walletFocusInput) {
  elements.walletFocusInput.addEventListener('input', rerenderActivityFromControls);
}
if (elements.directionFilter) {
  elements.directionFilter.addEventListener('change', rerenderActivityFromControls);
}
if (elements.clearWalletFilter) {
  elements.clearWalletFilter.addEventListener('click', () => {
    if (elements.walletFocusInput) elements.walletFocusInput.value = '';
    if (elements.directionFilter) elements.directionFilter.value = 'all';
    state.focusWallet = '';
    state.direction = 'all';
    state.activityPage = 1;
    if (state.data) renderActivity(state.data);
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadLiveData();
});

loadLiveData();
scheduleRefresh();
