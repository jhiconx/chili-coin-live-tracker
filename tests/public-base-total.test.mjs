import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('public website does not feature the StudioTexter redemption example', () => {
  assert.doesNotMatch(html, /radio-proof|StudioTexter|10 CHI rewarded\. 5 CHI redeemed\./i);
  assert.doesNotMatch(html, /0x6abcd7181c6cb4dba30995ee0b11c31d73d624124d2dc31249d660d5bff30ca4/i);
  assert.doesNotMatch(html, /0x78fe523dc17304c9050ba6c2fc52edb2d3e177096b1d3659feabe0097c69ae81/i);
  assert.doesNotMatch(css, /\.radio-proof|\.proof-eyebrow/);
  assert.doesNotMatch(app, /Station redemption|isStationRedemption/);
});

test('Base CHI transaction total is separate from recent loaded transfer rows', () => {
  assert.match(html, /id="baseTxnTotal"/);
  assert.match(html, /id="baseTxnSource"/);
  assert.match(html, /Total Base CHI Transactions/);
  assert.match(html, /token-transfer count reported by BaseScan/);
  assert.match(app, /const baseTxCount = data\.base\?\.transferCount;/);
  assert.match(app, /hasBaseTxCount \? formatNumber\(baseTxCount\) : '—'/);
  assert.match(app, /data\.base\?\.transferCountSource/);
  assert.doesNotMatch(app, /baseTxnTotal\.textContent = .*transfers\?\.length/);
});

test('20-per-page navigation remains available', () => {
  assert.match(html, /id="transactionPrevious"/);
  assert.match(html, /id="transactionNext"/);
  assert.match(app, /paginateTransactions\(rows, state\.transactionPage\)/);
  assert.match(app, /page\.rows\.map\(row/);
  assert.match(app, /state\.transactionPage !== 1/);
});
