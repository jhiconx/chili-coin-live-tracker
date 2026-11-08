import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paginateTransactions, TRANSACTIONS_PER_PAGE } from '../txn-pagination.js';

const sample = Array.from({ length: 45 }, (_, i) => ({ id: i + 1 }));

test('loads transactions 20 at a time, not an endless table', () => {
  assert.equal(TRANSACTIONS_PER_PAGE, 20);
  const p1 = paginateTransactions(sample, 1);
  assert.equal(p1.rows.length, 20);
  assert.deepEqual([p1.first, p1.last, p1.page, p1.totalPages], [1, 20, 1, 3]);
  assert.equal(p1.hasPrevious, false);
  assert.equal(p1.hasNext, true);

  const p2 = paginateTransactions(sample, 2);
  assert.deepEqual([p2.first, p2.last, p2.rows[0].id, p2.rows.at(-1).id], [21, 40, 21, 40]);
  assert.equal(p2.hasPrevious, true);
  assert.equal(p2.hasNext, true);

  const p3 = paginateTransactions(sample, 3);
  assert.equal(p3.rows.length, 5);
  assert.deepEqual([p3.first, p3.last], [41, 45]);
  assert.equal(p3.hasPrevious, true);
  assert.equal(p3.hasNext, false);
});

test('first and final pages clamp safely; empty history has no next page', () => {
  assert.deepEqual(paginateTransactions(sample, 999).rows.map(x => x.id), [41, 42, 43, 44, 45]);
  assert.equal(paginateTransactions(sample, 999).page, 3);
  assert.equal(paginateTransactions(sample, -5).page, 1);
  assert.equal(paginateTransactions(sample, NaN).page, 1);
  const empty = paginateTransactions([], 40);
  assert.deepEqual([empty.total, empty.first, empty.last, empty.page, empty.totalPages], [0, 0, 0, 1, 1]);
  assert.equal(empty.hasNext, false);
  assert.equal(empty.hasPrevious, false);
  assert.equal(paginateTransactions([sample[0]], 1).hasNext, false);
});

test('website includes accessible Previous and Next, filter reset and live-refresh pause', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(html, /id="transactionPrevious"/);
  assert.match(html, /id="transactionNext"/);
  assert.match(html, /id="transactionPageStatus"/);
  assert.match(app, /paginateTransactions\(rows, state\.transactionPage\)/);
  assert.match(app, /page\.rows\.map\(row =>/);
  assert.match(app, /state\.transactionPage = 1;/);
  assert.match(app, /state\.transactionPage !== 1/);
});
