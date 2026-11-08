import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeTransferLog } from '../lib/verified-base.js';

const contract = '0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8';
const topic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const src = '0xe9fbb243f3fb7400732fac4e564bbbabc753ddf4';
const dst = '0x3e10091482ecf1855fdf13e4f1a536de719db68a';
const receiptLog = {
  address: contract,
  topics: [topic,
    '0x' + src.slice(2).padStart(64, '0'),
    '0x' + dst.slice(2).padStart(64, '0')
  ],
  transactionHash: '0x6abcd7181c6cb4dba30995ee0b11c31d73d624124d2dc31249d660d5bff30ca4',
  data: '0x' + (10n * 10n ** 18n).toString(16).padStart(64, '0'),
  blockNumber: '0x3452f69',
  logIndex: '0x36'
};

test('decodes exactly one actual Base CHI transfer event', () => {
  const row = normalizeTransferLog(receiptLog, 1794158614);
  assert.equal(row.hash, receiptLog.transactionHash);
  assert.equal(row.from, src);
  assert.equal(row.to, dst);
  assert.equal(row.value, '10000000000000000000');
  assert.equal(row.tokenDecimal, 18);
  assert.equal(row.timeStamp, 1794158614);
});

test('rejects unsupported contracts, unrelated logs, and malformed transaction data', () => {
  assert.equal(normalizeTransferLog({ ...receiptLog, address: src }, 1794158614), null);
  assert.equal(normalizeTransferLog({ ...receiptLog, topics: ['0x' + '0'.repeat(64), ...receiptLog.topics.slice(1)] }, 1794158614), null);
  assert.equal(normalizeTransferLog({ ...receiptLog, data: '0x11' }, 1794158614), null);
  assert.equal(normalizeTransferLog(receiptLog, 0), null);
});

test('public tracker restores transaction table, and never relies on scraped BaseScan guesses', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../api/live.js', import.meta.url), 'utf8');
  assert.match(html, /id="activity"/);
  assert.match(html, /id="activityRows"/);
  assert.match(html, /id="walletFocusInput"/);
  assert.match(api, /fetchVerifiedBaseTransferRows/);
  assert.doesNotMatch(api, /async \(\) => fetchBaseScanScrapedRows/);
});
