# Chili Coin Live Tracker — V9 BaseScan Sync Fix

This replacement package fixes the Base transaction reporting problem.

What changed:

- Base transaction rows now prioritize the CHI ERC-20 `Transfer` event.
- `Source Wallet` now means the CHI `from` wallet — the wallet CHI flowed out of.
- `Recipient` means the CHI `to` wallet.
- Amount is decoded from the ERC-20 transfer value, so 5 CHI and other reward amounts display correctly.
- The TXN card uses indexed transfer-event counts instead of only the latest loaded rows.
- If `ETHERSCAN_API_KEY` is configured in Vercel, Base rows use Etherscan/BaseScan V2 logs for the closest match to the BaseScan transfer tab.
- If no API key is configured, the site falls back to Blockscout public token-transfer data and links back to BaseScan.

## Important Vercel setting for closest BaseScan match

In Vercel, add this environment variable:

```text
ETHERSCAN_API_KEY=your_etherscan_api_key
```

Etherscan API V2 uses one key across supported EVM chains. Base Mainnet uses `chainid=8453`.

After adding the variable, redeploy the project.

## Upload

Upload everything inside this folder to GitHub, including the whole `api` and `assets` folders.

Recommended commit message:

```text
Fix BaseScan CHI transaction reporting
```
