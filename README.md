# Chili Coin Live Wallet Tracker

A Vercel-ready live website using the supplied Chili Coin mascot and circular logo.

## What the tracker reads

- **Ethereum holder total:** public Ethereum Blockscout token metadata for `0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA`.
- **Base holder total:** the BaseScan page supplied for the ERC-1155 contract `0x65aa05778b093ea8f3ecdaff6f070a30eb15c3d3`, filtered by wallet `0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8`.
- **Recent Base activity:** public Base Blockscout ERC-1155 transfer records involving the filtered wallet and token contract.
- **Refresh:** the browser requests `/api/live` every 20 seconds. The serverless endpoint caches responses for 15 seconds to reduce explorer traffic.

The BaseScan page currently identifies `0x65aa...c3d3` as the ERC-1155 token contract and `0x25Ec...65E8` as the filtered token-holder wallet. The website labels these separately.

## Deploy on Vercel

1. Create a new GitHub repository and upload all files in this folder. Do not upload only `index.html`; the `/api/live.js` file is required.
2. In Vercel, choose **Add New → Project**, import the GitHub repository, and leave the framework preset as **Other**.
3. Leave Build Command and Output Directory blank. Vercel will serve the static files and automatically deploy `api/live.js` as a serverless function.
4. Select **Deploy**.
5. Open the Vercel URL and confirm that the status changes from “Connecting” to “Live sources connected” or “Live with source warnings.”

No API key is required for the included version.

## Run locally

```bash
npm install
npm run dev
```

Then open the local URL printed by Vercel CLI.

## Important limitations

- This is **near-real-time**, not a direct block-by-block WebSocket feed. Explorer/indexer data can lag the newest Base block.
- The BaseScan holder figure is read server-side from the public BaseScan page. If BaseScan changes its page structure or blocks automated reads, the endpoint attempts to identify the issue and can fall back to Blockscout rather than falsely claiming a BaseScan number.
- “Custodial” and “non-custodial” are operating-model labels supplied for Chili Coin. Public blockchain data cannot independently prove private-key control.
- The combined chain total is the sum of both chain-level holder figures. It is not a deduplicated count of unique people.

## Main files

- `index.html` — page structure
- `styles.css` — responsive visual design
- `app.js` — browser refresh, rendering, search, and activity table
- `api/live.js` — server-side BaseScan/Blockscout data aggregation
- `assets/` — supplied Chili Coin branding optimized for the web
