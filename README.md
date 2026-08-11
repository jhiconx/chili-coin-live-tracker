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


## V11 deployment note

Optional but strongly recommended in Vercel:

- Variable: `BASE_RPC_URL`
- Value: a production Base Mainnet HTTPS RPC endpoint from your RPC provider.

The package falls back to the public Base endpoint when the variable is absent.


## V12 HTTP 500 correction

V11 contained a server-side initialization error in `api/live.js`: it referenced the
`baseInfo` Promise result while the `Promise.allSettled()` request list was still being
constructed. V12 removes that invalid reference and passes the CHI token's 18 decimals
directly to the Base RPC transfer reader.

Only `api/live.js` must be replaced when upgrading from V11 to V12.


## V13 logo and hero layout update

- Replaced the top-left Chili Coin brand image with `assets/chi-mark.png`.
- Removed the large mascot image from the Live Wallet Tracker hero section.
- Replaced the Important Data Notice image with the same CHI mark.
- Expanded the hero copy across the available width.


## V14 Base transaction freshness

V14 changes the direct Base RPC scanner to 1,500-block `eth_getLogs` ranges and
processes them in small concurrent groups. This follows Base's guidance to keep
log filters under 2,000 blocks for reliable results.

The Base RPC overlay is now fault tolerant:
- A failed block range no longer removes all Base records.
- Block timestamp and transaction-signer enrichment are best-effort.
- Recent Base Transfer logs remain visible even if enrichment requests are rate-limited.
- `/api/live` now returns `transactions.baseRpcDiagnostics` for troubleshooting.

For production, set `BASE_RPC_URL` in Vercel to a dedicated Base Mainnet HTTPS RPC
endpoint. The built-in `https://mainnet.base.org` fallback is rate-limited.
