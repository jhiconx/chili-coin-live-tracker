# Chili Coin Live Tracker — V12 Fast Stable Base

This replacement removes the slow/hit-or-miss BaseScan page-scraping path from the live refresh loop.

## What changed

- Base loads from a public token indexer first, so Base does not wait on BaseScan HTML/text mirrors.
- Automatic refresh now uses Vercel caching instead of forcing a new uncached server request every 20 seconds.
- Manual **Refresh now** still bypasses cache.
- The TXN table keeps using ERC-20 `from` as **Source Wallet** and ERC-20 `to` as **Recipient**.
- BaseScan remains the official review link for Base transfers.

## Upload

Upload all files and folders in this replacement folder to GitHub, including the `api` folder.
