# Chili Coin Live Wallet Tracker — V10 Stable Base API Fix

This replacement set fixes the intermittent Base reporting problem.

## What changed

- Base transaction rows now prioritize the Etherscan/BaseScan V2 `account/tokentx` ERC-20 token transfer endpoint using `chainid=8453`.
- Source Wallet now means the ERC-20 CHI `from` wallet, matching the wallet CHI flowed out of on BaseScan.
- Recipient means the ERC-20 CHI `to` wallet.
- Amount is decoded from the actual token transfer value.
- Base holder count no longer depends on scraping the BaseScan HTML page, which can be slow or blocked. Holder count uses Blockscout counters, while Base transaction flow uses the BaseScan/Etherscan API when `ETHERSCAN_API_KEY` is configured.
- Blockscout remains a labeled fallback if the API key is missing or the Etherscan/BaseScan V2 request fails.

## Required Vercel environment variable

Add this in Vercel Project Settings → Environment Variables:

```text
ETHERSCAN_API_KEY
```

Use a real Etherscan API key. Do not use a Stripe/Resend/other `sk_live...` key.

After adding the environment variable, redeploy the project.

## Upload

Upload everything inside this folder to GitHub, including the full `api` and `assets` folders.
