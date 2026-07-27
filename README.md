# Chili Coin Live Wallet Tracker — V6 Transaction Flow

This update adds a live TXN card and an all-chain CHI transaction-flow table.

## What changed

- Added a fourth dashboard metric: **TXN — All Chain Transactions**.
- Added live Ethereum + Base CHI transfer loading from public indexers.
- Updated the activity section to show CHI flowing **in** and **out** of a pasted wallet address.
- Added a wallet-focus input, flow filter, and Clear button.
- Added table columns: Time, Chain, Flow, From, To, Amount (CHI), TXN.
- Kept the favicon/browser-tab Chili image from V5.

## Upload to GitHub

Upload everything inside this replacement folder to the existing `chili-coin-live-tracker` GitHub repository:

```text
index.html
styles.css
app.js
api
assets
README.md
SOURCE_NOTES.md
```

Commit directly to `main`. Vercel should automatically redeploy.

## Note about the TXN number

The TXN card shows the latest indexed transfer-event count loaded from the public Ethereum and Base indexers during the live refresh. It is not a verified all-time transaction count.
