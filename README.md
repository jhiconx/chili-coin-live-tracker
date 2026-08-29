# Chili Coin Live Tracker — V13 BaseScan API Primary

This replacement removes the slow/hit-or-miss BaseScan page-scraping path from the live refresh loop.

## What changed

- Base loads from a public token indexer first, so Base does not wait on BaseScan HTML/text mirrors.
- Automatic refresh now uses Vercel caching instead of forcing a new uncached server request every 20 seconds.
- Manual **Refresh now** still bypasses cache.
- The TXN table keeps using ERC-20 `from` as **Source Wallet** and ERC-20 `to` as **Recipient**.
- BaseScan remains the official review link for Base transfers.

## Upload

Upload all files and folders in this replacement folder to GitHub, including the `api` folder.


## V13 BaseScan/Etherscan API Primary

This version fixes the Base holder mismatch caused by Blockscout fallback counters. When `ETHERSCAN_API_KEY` is configured in Vercel and the site is redeployed, the live API tries Etherscan API V2 first:

- Ethereum: `chainid=1`
- Base: `chainid=8453`
- Holder count: `module=token&action=tokenholdercount`
- ERC-20 transfers: `module=account&action=tokentx`

If the key is missing, invalid, or accidentally set to a non-Etherscan value such as `sk_live...`, the site will ignore it and use Blockscout fallback data. In that fallback mode, Base holder totals can lag BaseScan.
