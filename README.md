# Chili Coin Live Wallet Tracker — V10 Network Notice

This package preserves the V9 live feed, pagination, filters, visual design and Chili Coin assets.

## Changes

- Adds a concise Ethereum-versus-Base explanation to **Important Data Notice**.
- States that Ethereum Mainnet is Layer 1 and Base is a separate EVM-compatible Layer 2.
- Clarifies that each network has separate transactions, explorers, CHI contracts, balances and fees.
- Keeps the live Blockscout API v2 transaction feed.
- Keeps 20 transaction records per page with Previous, Next and numbered pagination.
- Keeps wallet-focus and in/out filters.

## Upload

Upload everything inside this folder to the root of the GitHub repository:

- `index.html`
- `styles.css`
- `app.js`
- `api/live.js`
- `assets/`
- `README.md`
- `SOURCE_NOTES.md`

Commit to `main`. Vercel should redeploy automatically.

Suggested commit message:

```text
Add Ethereum and Base network notice
```
