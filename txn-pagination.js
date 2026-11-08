// Finite client-side pagination for the latest loaded blockchain transactions.
// 20 rows per page; this does not fetch or invent older blockchain history.
export const TRANSACTIONS_PER_PAGE = 20;

export function paginateTransactions(rows, requestedPage = 1) {
  const items = Array.isArray(rows) ? rows : [];
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / TRANSACTIONS_PER_PAGE));
  const validPage = Number.isInteger(requestedPage) && requestedPage > 0
    ? requestedPage : 1;
  const page = Math.min(validPage, totalPages);
  const start = (page - 1) * TRANSACTIONS_PER_PAGE;
  const end = Math.min(start + TRANSACTIONS_PER_PAGE, total);

  return {
    rows: items.slice(start, end),
    page,
    totalPages,
    total,
    first: total ? start + 1 : 0,
    last: end,
    hasPrevious: page > 1,
    hasNext: page < totalPages
  };
}
